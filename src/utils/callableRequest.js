import { app, auth, FUNCTIONS_REGION } from '../firebase-config';

const HTTP_FUNCTION_NAME_MAP = {
  admin_listUsers: 'admin_httpListUsers',
  admin_deleteUser: 'admin_httpDeleteUser',
  admin_upsertUserProfile: 'admin_httpUpsertUserProfile',
  admin_createAuthUserAndProfile: 'admin_httpCreateAuthUserAndProfile',
  admin_setUserPassword: 'admin_httpSetUserPassword',
  admin_unlockUser: 'admin_httpUnlockUser',
  auth_trackAttempt: 'auth_httpTrackAttempt',
  auth_syncOwnClaims: 'auth_httpSyncOwnClaims',
  kiosk_updateSection: 'kiosk_httpUpdateSection',
  kiosk_updateSlotLock: 'kiosk_httpUpdateSlotLock',
  media_listAssets: 'media_httpListAssets',
  media_createUploadUrl: 'media_httpCreateUploadUrl',
  media_finalizeUpload: 'media_httpFinalizeUpload',
  media_archiveAsset: 'media_httpArchiveAsset',
  media_deleteAsset: 'media_httpDeleteAsset',
  media_assignPlaylist: 'media_httpAssignPlaylist',
  aiBooths_listEvents: 'aiBooths_httpListEvents',
  aiBooths_saveEvent: 'aiBooths_httpSaveEvent',
  aiBooths_provisionPendingKiosk: 'aiBooths_httpProvisionPendingKiosk',
  aiBooths_listElevenLabsAgents: 'aiBooths_httpListElevenLabsAgents',
  aiBooths_publishAgent: 'aiBooths_httpPublishAgent',
  stationBinding_getNextStation: 'stationBinding_httpGetNextStation',
  stationBinding_listStationReservations: 'stationBinding_httpListStationReservations',
  stationBinding_setStationReservation: 'stationBinding_httpSetStationReservation',
  stationBinding_bindModule: 'stationBinding_httpBindModule',
  stationBinding_unbindModule: 'stationBinding_httpUnbindModule',
  stationBinding_moveModule: 'stationBinding_httpMoveModule',
};

function shouldUseLocalFunctionProxy() {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function getCallableUrl(functionName) {
  const resolvedName = HTTP_FUNCTION_NAME_MAP[functionName] || functionName;

  if (shouldUseLocalFunctionProxy()) {
    return `/__functions/${resolvedName}`;
  }

  const projectId = app?.options?.projectId;

  if (!projectId) {
    throw new Error('Missing Firebase project ID.');
  }

  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net/${resolvedName}`;
}

function getErrorMessage(payload, fallbackMessage) {
  if (!payload?.error) {
    return fallbackMessage;
  }

  return payload.error.message || payload.error.status || fallbackMessage;
}

export async function callFunctionWithAuth(functionName, data = {}, options = {}) {
  if (!auth.currentUser) {
    throw new Error('Not signed in');
  }

  const {
    timeoutMs = 0,
    timeoutMessage = '',
    abortController = null,
    abortMessage = '',
  } = options;

  const controller = abortController || (typeof AbortController !== 'undefined' ? new AbortController() : null);
  let didTimeout = false;
  let timeoutId = null;
  if (controller && Number(timeoutMs) > 0) {
    timeoutId = globalThis.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, Number(timeoutMs));
  }

  let idToken = '';
  try {
    idToken = await auth.currentUser.getIdToken(true);
  } catch (error) {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
    throw error;
  }
  let response;
  try {
    response = await fetch(getCallableUrl(functionName), {
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
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }

    if (didTimeout) {
      throw new Error(timeoutMessage || `${functionName} timed out.`);
    }

    if (controller?.signal?.aborted) {
      throw new Error(abortMessage || 'Request canceled.');
    }

    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (timeoutId) {
    globalThis.clearTimeout(timeoutId);
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
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    throw new Error(getErrorMessage(payload, `Request failed (${response.status})`));
  }

  return payload?.result ?? payload?.data ?? payload ?? {};
}
