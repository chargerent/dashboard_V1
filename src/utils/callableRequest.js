import { app, auth, FUNCTIONS_REGION } from '../firebase-config';

const HTTP_FUNCTION_NAME_MAP = {
  admin_listUsers: 'admin_httpListUsers',
  admin_deleteUser: 'admin_httpDeleteUser',
  admin_upsertUserProfile: 'admin_httpUpsertUserProfile',
  admin_createAuthUserAndProfile: 'admin_httpCreateAuthUserAndProfile',
  admin_setUserPassword: 'admin_httpSetUserPassword',
  admin_unlockUser: 'admin_httpUnlockUser',
  auth_trackAttempt: 'auth_httpTrackAttempt',
  stationBinding_getNextStation: 'stationBinding_httpGetNextStation',
  stationBinding_bindModule: 'stationBinding_httpBindModule',
  stationBinding_unbindModule: 'stationBinding_httpUnbindModule',
  stationBinding_moveModule: 'stationBinding_httpMoveModule',
};

function getCallableUrl(functionName) {
  const projectId = app?.options?.projectId;

  if (!projectId) {
    throw new Error('Missing Firebase project ID.');
  }

  const resolvedName = HTTP_FUNCTION_NAME_MAP[functionName] || functionName;
  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${resolvedName}`;
}

function getErrorMessage(payload, fallbackMessage) {
  if (!payload?.error) {
    return fallbackMessage;
  }

  return payload.error.message || payload.error.status || fallbackMessage;
}

export async function callFunctionWithAuth(functionName, data = {}) {
  if (!auth.currentUser) {
    throw new Error('Not signed in');
  }

  const idToken = await auth.currentUser.getIdToken(true);
  const response = await fetch(getCallableUrl(functionName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      data: {
        ...data,
        __authToken: idToken,
      },
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    throw new Error(getErrorMessage(payload, `Request failed (${response.status})`));
  }

  return payload?.result ?? payload?.data ?? payload ?? {};
}

export async function callFunctionPublic(functionName, data = {}) {
  const response = await fetch(getCallableUrl(functionName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    throw new Error(getErrorMessage(payload, `Request failed (${response.status})`));
  }

  return payload?.result ?? payload?.data ?? payload ?? {};
}
