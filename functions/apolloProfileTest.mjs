import crypto from 'node:crypto';

const TEST_COLLECTION = 'apolloProfileTests';
const TEST_LOCK_COLLECTION = 'apolloProfileTestLocks';
const TEST_TTL_MS = 15 * 60 * 1000;
const CPS_BASE_URLS = {
  production: 'https://cps.mypayter.com/',
  test: 'https://cps-test.mypayter.com/',
  dev: 'https://cps.dev.mypayter.com/',
};
const clean = (value) => String(value ?? '').trim();
const upper = (value) => clean(value).toUpperCase();
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'));
  const expected = Buffer.from(clean(expectedHash));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function makeRequestId(testId, step, screenId) {
  return `profile-test_${testId}_${step}_${screenId}`.slice(0, 160);
}

function callbackUrlFor(baseUrl, testId, token) {
  const url = new URL(baseUrl);
  url.searchParams.set('testId', testId);
  url.searchParams.set('token', token);
  return url.toString();
}

async function postScreen({apiKey, baseUrl, callbackUrl, fetchImpl, request, serialNumber}) {
  const url = new URL(`/terminals/${encodeURIComponent(serialNumber)}/ui`, baseUrl);
  url.searchParams.set('callbackUrl', callbackUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `CPS apikey="${apiKey}"`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CPS returned HTTP ${response.status}.`);
  } finally {
    clearTimeout(timeout);
  }
}

function publicTestStatus(test) {
  return {
    id: clean(test.id),
    stationid: upper(test.stationid),
    profileId: clean(test.profileId),
    profileVersion: Number(test.profileVersion || 0),
    status: clean(test.status),
    currentScreenId: clean(test.currentScreenId),
    completionAction: clean(test.completionAction),
    error: clean(test.error),
    createdAt: clean(test.createdAt),
    updatedAt: clean(test.updatedAt),
    expiresAt: clean(test.expiresAt),
  };
}

async function releaseTestLock(db, stationid, testId) {
  const lockRef = db.collection(TEST_LOCK_COLLECTION).doc(stationid);
  await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    if (lockSnap.exists && clean(lockSnap.data()?.testId) === testId) transaction.delete(lockRef);
  });
}

export async function startApolloProfileTest(data, authState, deps) {
  const {
    HttpsError, apiKey, callbackUrl, db, fetchImpl = fetch,
    isApolloAdmin, now = () => Date.now(), randomBytes = crypto.randomBytes,
  } = deps;
  if (!isApolloAdmin(authState)) fail(HttpsError, 'permission-denied', 'Apollo terminal tests require administrator access.');
  if (!clean(apiKey)) fail(HttpsError, 'failed-precondition', 'The Payter CPS API key is not configured.');

  const profileId = clean(data?.profileId).toLowerCase();
  const stationid = upper(data?.stationid);
  const expectedVersion = Number(data?.expectedVersion);
  const language = ['en', 'fr', 'es'].includes(clean(data?.language).toLowerCase()) ? clean(data.language).toLowerCase() : 'en';
  if (!profileId || !stationid || !Number.isFinite(expectedVersion)) fail(HttpsError, 'invalid-argument', 'profileId, expectedVersion and stationid are required.');

  const [runtimeSnap, profileSnap, kioskSnap] = await Promise.all([
    db.collection('payterRuntime').doc('current').get(),
    db.collection('uiProfiles').doc(profileId).get(),
    db.collection('kiosks').where('stationid', '==', stationid).get(),
  ]);
  const runtime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
  if (runtime.apolloProfileTestsEnabled !== true) fail(HttpsError, 'failed-precondition', 'Apollo terminal testing is locked.');
  const allowedStationIds = new Set((Array.isArray(runtime.apolloTestStationIds) ? runtime.apolloTestStationIds : []).map(upper));
  if (!allowedStationIds.has(stationid)) fail(HttpsError, 'permission-denied', `${stationid} is not allowlisted for Apollo profile testing.`);
  if (!profileSnap.exists) fail(HttpsError, 'not-found', 'Client profile not found.');
  if (kioskSnap.size !== 1) fail(HttpsError, 'failed-precondition', 'The selected kiosk is missing or duplicated.');

  const profile = {id: profileSnap.id, ...profileSnap.data()};
  const kiosk = kioskSnap.docs[0].data() || {};
  const clientId = upper(profile.clientId);
  const kioskClientId = upper(kiosk.info?.client || kiosk.info?.clientId);
  if (!clientId || kioskClientId !== clientId) fail(HttpsError, 'failed-precondition', 'The kiosk is not assigned to this client profile.');
  if (upper(kiosk.hardware?.gateway) !== 'APOLLO') fail(HttpsError, 'failed-precondition', 'The selected kiosk is not an APOLLO kiosk.');
  if (Number(profile.version) !== expectedVersion) fail(HttpsError, 'aborted', 'The client profile changed. Reload it before testing.');
  const serialNumber = clean(kiosk.hardware?.sn);
  if (!serialNumber || serialNumber.length > 120) fail(HttpsError, 'failed-precondition', 'The selected kiosk does not have a valid Apollo terminal serial number.');

  const {buildApolloScreenRequest, validateApolloScreenFlow} = await deps.loadScreenHelpers();
  const flow = clone(profile.terminalProfiles?.apollo?.screenFlow);
  try {
    validateApolloScreenFlow(flow);
  } catch (error) {
    fail(HttpsError, 'invalid-argument', error.message);
  }
  if (!flow.entryScreenId) fail(HttpsError, 'failed-precondition', 'Choose an added screen under After Start, show before testing a terminal.');
  const firstScreen = flow.screens.find(({id}) => id === flow.entryScreenId);
  if (!firstScreen) fail(HttpsError, 'failed-precondition', 'The first Apollo test screen is missing.');

  const environment = clean(runtime.apolloCpsEnvironment).toLowerCase() || 'test';
  const baseUrl = CPS_BASE_URLS[environment];
  if (!baseUrl) fail(HttpsError, 'failed-precondition', 'Choose a supported Apollo CPS environment.');
  const testRef = db.collection(TEST_COLLECTION).doc();
  const token = randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const createdAtMs = now();
  const createdAt = new Date(createdAtMs).toISOString();
  const expiresAt = new Date(createdAtMs + TEST_TTL_MS).toISOString();
  const requestId = makeRequestId(testRef.id, 1, firstScreen.id);
  const vendorCallbackUrl = callbackUrlFor(callbackUrl, testRef.id, token);
  const request = buildApolloScreenRequest(flow, firstScreen.id, language, requestId);
  const record = {
    id: testRef.id, stationid, serialNumber, clientId, profileId, profileVersion: Number(profile.version),
    language, flow, currentScreenId: firstScreen.id, currentRequestId: requestId, step: 1,
    // Store the correlation state before making the CPS request. A very fast
    // vendor callback must never arrive while this record still says sending.
    status: 'waiting', environment, tokenHash, createdAt, updatedAt: createdAt, expiresAt,
    createdByUid: clean(authState?.uid), createdByUsername: clean(authState?.profile?.username).toLowerCase(),
  };
  const lockRef = db.collection(TEST_LOCK_COLLECTION).doc(stationid);
  await db.runTransaction(async (transaction) => {
    const lockSnap = await transaction.get(lockRef);
    const lock = lockSnap.exists ? lockSnap.data() || {} : {};
    if (lockSnap.exists && Date.parse(lock.expiresAt) > createdAtMs) {
      fail(HttpsError, 'failed-precondition', `${stationid} already has an active Apollo screen test.`);
    }
    transaction.set(testRef, record);
    transaction.set(lockRef, {testId: testRef.id, stationid, expiresAt, createdAt});
  });
  try {
    await postScreen({apiKey, baseUrl, callbackUrl: vendorCallbackUrl, fetchImpl, request, serialNumber});
    return publicTestStatus(record);
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Payter CPS timed out.' : clean(error?.message) || 'Payter CPS request failed.';
    await testRef.update({status: 'error', error: message, updatedAt: new Date(now()).toISOString()});
    await releaseTestLock(db, stationid, testRef.id);
    fail(HttpsError, 'unavailable', message);
  }
}

export async function readApolloProfileTest(data, authState, deps) {
  const {HttpsError, db, isApolloAdmin, now = () => Date.now()} = deps;
  if (!isApolloAdmin(authState)) fail(HttpsError, 'permission-denied', 'Apollo terminal tests require administrator access.');
  const testId = clean(data?.testId);
  if (!testId) fail(HttpsError, 'invalid-argument', 'testId required.');
  const snap = await db.collection(TEST_COLLECTION).doc(testId).get();
  if (!snap.exists) fail(HttpsError, 'not-found', 'Apollo profile test not found.');
  const test = {id: snap.id, ...snap.data()};
  if (test.status === 'waiting' && Date.parse(test.expiresAt) <= now()) {
    test.status = 'expired';
    test.updatedAt = new Date(now()).toISOString();
    await snap.ref.update({status: test.status, updatedAt: test.updatedAt});
    await releaseTestLock(db, test.stationid, test.id);
  }
  return publicTestStatus(test);
}

export async function handleApolloProfileTestCallback(query, body, deps) {
  const {HttpsError, apiKey, callbackUrl, db, fetchImpl = fetch, now = () => Date.now()} = deps;
  const testId = clean(query?.testId);
  const token = clean(query?.token);
  const serialNumber = clean(body?.serialNumber);
  const requestId = clean(body?.screenId);
  const response = clean(body?.response);
  if (!testId || !token || !serialNumber || !requestId || !response) fail(HttpsError, 'invalid-argument', 'Invalid Apollo UI callback.');

  const {buildApolloScreenRequest, resolveApolloScreenAction} = await deps.loadScreenHelpers();
  const testRef = db.collection(TEST_COLLECTION).doc(testId);
  let transition;
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(testRef);
    if (!snap.exists) fail(HttpsError, 'not-found', 'Apollo profile test not found.');
    const test = snap.data() || {};
    if (!tokenMatches(token, test.tokenHash)) fail(HttpsError, 'permission-denied', 'Invalid Apollo profile test token.');
    if (Date.parse(test.expiresAt) <= now()) fail(HttpsError, 'failed-precondition', 'Apollo profile test expired.');
    if (serialNumber !== test.serialNumber) fail(HttpsError, 'failed-precondition', 'Apollo callback terminal does not match the test.');
    if (requestId !== test.currentRequestId || test.status !== 'waiting') {
      transition = {duplicate: true, status: clean(test.status)};
      return;
    }
    let action;
    try {
      action = resolveApolloScreenAction(test.flow, test.currentScreenId, response);
    } catch (error) {
      fail(HttpsError, 'invalid-argument', error.message);
    }
    const updatedAt = new Date(now()).toISOString();
    if (action.action !== 'show_screen') {
      const lockRef = db.collection(TEST_LOCK_COLLECTION).doc(upper(test.stationid));
      const lockSnap = await transaction.get(lockRef);
      transaction.update(testRef, {status: 'complete', completionAction: action.action, response, updatedAt});
      if (lockSnap.exists && clean(lockSnap.data()?.testId) === testId) transaction.delete(lockRef);
      transition = {status: 'complete', action: action.action};
      return;
    }
    const step = Number(test.step || 1) + 1;
    const nextRequestId = makeRequestId(testId, step, action.screenId);
    transaction.update(testRef, {
      // Pin the next request before sending it for the same callback-race
      // reason as the initial screen.
      status: 'waiting', currentScreenId: action.screenId, currentRequestId: nextRequestId,
      step, response, updatedAt,
    });
    transition = {
      status: 'waiting', screenId: action.screenId, requestId: nextRequestId,
      flow: test.flow, language: test.language, serialNumber: test.serialNumber,
      stationid: upper(test.stationid), environment: test.environment,
    };
  });
  if (!transition || transition.duplicate || transition.status === 'complete') return {ok: true, ...transition};

  const baseUrl = CPS_BASE_URLS[transition.environment];
  if (!baseUrl || !clean(apiKey)) fail(HttpsError, 'failed-precondition', 'Apollo CPS is not configured.');
  const request = buildApolloScreenRequest(transition.flow, transition.screenId, transition.language, transition.requestId);
  try {
    await postScreen({
      apiKey, baseUrl, callbackUrl: callbackUrlFor(callbackUrl, testId, token), fetchImpl,
      request, serialNumber: transition.serialNumber,
    });
    return {ok: true, status: 'waiting'};
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'Payter CPS timed out.' : clean(error?.message) || 'Payter CPS request failed.';
    await testRef.update({status: 'error', error: message, updatedAt: new Date(now()).toISOString()});
    await releaseTestLock(db, transition.stationid, testId);
    fail(HttpsError, 'unavailable', message);
  }
}
