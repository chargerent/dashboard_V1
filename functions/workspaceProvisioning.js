/* eslint-env node */
const {randomBytes, randomUUID} = require("node:crypto");

const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user";
const DIRECTORY_USERS = "https://admin.googleapis.com/admin/directory/v1/users";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const LEASE_MS = 5 * 60 * 1000;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function failure(code, message) {
  return Object.assign(new Error(message), {code, safe: true});
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacters(value) {
  return [...value].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);
}

function safeFailure(error) {
  if (error && error.safe) return {errorCode: error.code, message: error.message};
  return {
    errorCode: "workspace-unavailable",
    message: "Google Workspace could not be reached. Retry the mailbox request; the dashboard account is already saved.",
  };
}

function profileSummary(result, notification = null) {
  return {
    status: result.status,
    email: result.email,
    message: result.message,
    ...(result.googleUserId ? {googleUserId: result.googleUserId} : {}),
    ...(result.errorCode ? {errorCode: result.errorCode} : {}),
    ...(notification && ["sent", "pending", "error", "unknown"].includes(notification.status) ? {
      notificationStatus: notification.status,
      notificationEmail: notification.recipient || "",
      notificationMessage: notification.message || "",
    } : {}),
  };
}

/** Directory access stays on the server; credentials and passwords never enter Firestore. */
function createWorkspaceProvisioning({admin, db, fetchImpl = global.fetch, env = process.env}) {
  const domain = text(env.WORKSPACE_DOMAIN || "charge.rent").toLowerCase();
  const delegatedAdmin = text(env.WORKSPACE_ADMIN_EMAIL).toLowerCase();
  const serviceAccount = text(env.WORKSPACE_SERVICE_ACCOUNT_EMAIL).toLowerCase();
  const orgUnitPath = text(env.WORKSPACE_ORG_UNIT_PATH);
  const allowedAdmins = new Set(text(env.WORKSPACE_DASHBOARD_ADMIN_UIDS).split(",").map(text).filter(Boolean));
  const configured = DOMAIN_RE.test(domain) && EMAIL_RE.test(delegatedAdmin) &&
    /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(serviceAccount) &&
    allowedAdmins.size > 0 &&
    (!orgUnitPath || (orgUnitPath.startsWith("/") && !hasControlCharacters(orgUnitPath)));
  const enabled = env.WORKSPACE_PROVISIONING_ENABLED === "true" && configured;
  let cachedToken = null;
  let tokenPromise = null;

  function getStatus() {
    return {
      enabled,
      configured,
      domain: DOMAIN_RE.test(domain) ? domain : "charge.rent",
      reason: enabled ? null : "Google Workspace account creation needs server configuration and Google administrator authorization.",
    };
  }

  function canProvision(actorUid) {
    return enabled && allowedAdmins.has(actorUid);
  }

  function requireActor(actorUid) {
    if (!enabled) throw failure("failed-precondition", getStatus().reason);
    if (!canProvision(actorUid)) {
      throw failure("permission-denied", "This administrator is not authorized to create Google Workspace accounts.");
    }
  }

  function normalizeAddress(localPart) {
    const normalized = text(localPart).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(normalized) || normalized.includes("..")) {
      throw failure("invalid-argument", `Enter an available company address at ${domain}, using letters, numbers, periods, hyphens, or underscores.`);
    }
    return {localPart: normalized, email: `${normalized}@${domain}`};
  }

  function validateRequest(request, {role} = {}) {
    if (!enabled) {
      throw failure("failed-precondition", getStatus().reason);
    }
    if (role !== "partner") {
      throw failure("permission-denied", "Company email accounts can only be created for partners.");
    }
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw failure("invalid-argument", "Enter the company email account details.");
    }
    const {localPart, email} = normalizeAddress(request.localPart);
    if (request.email && text(request.email).toLowerCase() !== email) {
      throw failure("invalid-argument", `The company email address must use ${domain}.`);
    }
    const givenName = text(request.givenName);
    const familyName = text(request.familyName);
    if (![givenName, familyName].every((name) => name.length > 0 && name.length <= 60 && !hasControlCharacters(name))) {
      throw failure("invalid-argument", "Enter a first name and last name, each up to 60 characters.");
    }
    const recoveryEmail = text(request.recoveryEmail).toLowerCase();
    if (recoveryEmail && (!EMAIL_RE.test(recoveryEmail) || recoveryEmail.length > 254 || recoveryEmail === email)) {
      throw failure("invalid-argument", "Enter an existing alternate email address for account recovery.");
    }
    return {localPart, email, givenName, familyName, recoveryEmail, role};
  }

  async function fetchJson(url, options, stage) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: global.AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch {
      throw failure("workspace-unavailable", "Google Workspace did not confirm the request. Retry to check the account before another creation attempt.");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      // Never return raw Google response bodies: auth errors can contain sensitive details.
      if (stage === "directory" && options.method === "GET" && response.status === 404) return {missing: true};
      if (stage === "directory" && response.status === 409) {
        throw failure("email-already-exists", "This company email address already exists. No existing Google account was changed.");
      }
      if (stage === "auth" || response.status === 401 || response.status === 403) {
        cachedToken = null;
        throw failure("workspace-authorization-required", "Google Workspace authorization is unavailable. Check domain-wide delegation, the delegated administrator, and service-account signing permissions.");
      }
      if (response.status === 400) {
        throw failure("workspace-request-rejected", "Google Workspace rejected the account details. Check the names, recovery email, organization unit, and domain settings.");
      }
      if (response.status === 429) {
        throw failure("workspace-rate-limited", "Google Workspace is temporarily limiting requests. Wait briefly and retry.");
      }
      throw failure("workspace-unavailable", "Google Workspace did not confirm the request. Retry to check the account before another creation attempt.");
    }
    if (!body || typeof body !== "object") {
      throw failure("workspace-unavailable", "Google Workspace returned an incomplete response. Retry to check the account.");
    }
    return body;
  }

  async function createDelegatedToken() {
    let accessToken;
    try {
      const credential = admin.app().options.credential || admin.credential.applicationDefault();
      accessToken = (await credential.getAccessToken()).access_token;
    } catch {
      throw failure("workspace-authorization-required", "The server could not authorize Google Workspace account creation. Check its service account configuration.");
    }
    if (!accessToken) throw failure("workspace-authorization-required", "The server's Google authorization is unavailable.");
    const now = Math.floor(Date.now() / 1000);
    const signed = await fetchJson(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signJwt`,
      {
        method: "POST",
        headers: {Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({payload: JSON.stringify({
          iss: serviceAccount,
          sub: delegatedAdmin,
          scope: DIRECTORY_SCOPE,
          aud: TOKEN_ENDPOINT,
          iat: now,
          exp: now + 3600,
        })}),
      },
      "auth",
    );
    if (!signed.signedJwt) throw failure("workspace-authorization-required", "Google Workspace signing authorization is incomplete.");
    const token = await fetchJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signed.signedJwt,
      }).toString(),
    }, "auth");
    if (!token.access_token || !(Number(token.expires_in) > 0)) {
      throw failure("workspace-authorization-required", "Google Workspace delegation authorization is incomplete.");
    }
    cachedToken = {value: token.access_token, expiresAt: Date.now() + Math.min(Number(token.expires_in), 3600) * 1000};
    return cachedToken.value;
  }

  async function delegatedToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
    if (!tokenPromise) tokenPromise = createDelegatedToken().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function checkAvailability(localPart, {actorUid} = {}) {
    requireActor(actorUid);
    const {email} = normalizeAddress(localPart);
    const token = await delegatedToken();
    const user = await fetchJson(`${DIRECTORY_USERS}/${encodeURIComponent(email)}?fields=id`, {
      method: "GET",
      headers: {Authorization: `Bearer ${token}`},
    }, "directory");
    return {available: user.missing === true, email};
  }

  function requireOwnedUser(user, uid, email, knownGoogleId) {
    const owned = Array.isArray(user.externalIds) && user.externalIds.some((entry) => (
      entry.type === "custom" && entry.customType === "dashboardUid" && entry.value === uid
    ));
    if (!owned || !user.id || (knownGoogleId && user.id !== knownGoogleId)) {
      throw failure("email-already-exists", "This company email address belongs to an existing Google account. No account was linked or changed. Resolve the address conflict in Google Admin before retrying.");
    }
    if (text(user.primaryEmail).toLowerCase() !== email) {
      throw failure("workspace-account-changed", "The linked Google account's address has changed. Review it in Google Admin; a second account was not created.");
    }
    if (user.suspended) {
      throw failure("workspace-account-suspended", "The linked Google account is suspended. Review it in Google Admin before retrying.");
    }
    return user;
  }

  function accountResult(user, email, temporaryPassword) {
    const ready = user.isMailboxSetup === true;
    return {
      status: ready ? "ready" : "pending",
      email,
      googleUserId: user.id,
      passwordAvailable: Boolean(temporaryPassword),
      passwordRecoveryRequired: !temporaryPassword,
      message: ready ? "Google confirms that the mailbox is set up." : "Google account created; Gmail activation is pending. Check the Workspace license and Gmail service, then refresh the status.",
      ...(temporaryPassword ? {temporaryPassword} : {
        passwordMessage: "The original temporary password cannot be shown again. If it was not saved, reset it in Google Admin. Retrying does not change the password.",
      }),
    };
  }

  async function provision({uid, request, actorUid}) {
    let normalized;
    let ref;
    let attemptId;
    let saved;
    try {
      requireActor(actorUid);
      normalized = validateRequest(request, {role: request && request.role});
      if (!text(uid) || uid.includes("/") || !text(actorUid)) {
        throw failure("invalid-argument", "A saved dashboard account and an authenticated admin are required.");
      }
      ref = db.collection("workspaceProvisioning").doc(uid);
      attemptId = randomUUID();
      const claim = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const existing = snapshot.exists ? snapshot.data() : null;
        if (existing && existing.email !== normalized.email) {
          throw failure("workspace-request-changed", "Retry the original company email address. Review its provisioning record before choosing a different address.");
        }
        if (existing && existing.status === "provisioning" && existing.leaseExpiresAt > Date.now()) {
          return {claimed: false, existing};
        }
        const next = {
          ...existing,
          uid,
          email: normalized.email,
          request: normalized,
          status: "provisioning",
          attemptId,
          leaseExpiresAt: Date.now() + LEASE_MS,
          attempts: Number(existing && existing.attempts || 0) + 1,
          actorUid,
          createdAt: existing && existing.createdAt || Date.now(),
          updatedAt: Date.now(),
          errorCode: null,
          message: null,
        };
        transaction.set(ref, next);
        transaction.update(db.collection("users").doc(uid), {
          workspaceMailbox: profileSummary({
            status: "provisioning",
            email: normalized.email,
            message: "Google account creation is in progress.",
          }, existing?.notification),
        });
        return {claimed: true, existing: next};
      });
      saved = claim.existing;
      if (!claim.claimed) {
        return {status: "provisioning", email: saved.email, message: "Google account creation is already in progress. Refresh its status shortly."};
      }
      const token = await delegatedToken();
      const headers = {Authorization: `Bearer ${token}`, "Content-Type": "application/json"};
      const getUser = () => fetchJson(
        `${DIRECTORY_USERS}/${encodeURIComponent(saved.googleUserId || normalized.email)}?projection=full&fields=id,primaryEmail,externalIds,isMailboxSetup,suspended`,
        {method: "GET", headers}, "directory",
      );
      let user = await getUser();
      let temporaryPassword;
      if (user.missing) {
        if (saved.googleUserId) {
          throw failure("workspace-account-missing", "The previously created Google account is missing. Review it in Google Admin; retrying will not replace or recreate it.");
        }
        temporaryPassword = `Gg7!${randomBytes(24).toString("base64url")}`;
        try {
          user = await fetchJson(DIRECTORY_USERS, {
            method: "POST",
            headers,
            body: JSON.stringify({
              primaryEmail: normalized.email,
              name: {givenName: normalized.givenName, familyName: normalized.familyName},
              password: temporaryPassword,
              changePasswordAtNextLogin: true,
              ...(normalized.recoveryEmail ? {recoveryEmail: normalized.recoveryEmail} : {}),
              externalIds: [{type: "custom", customType: "dashboardUid", value: uid}],
              ...(orgUnitPath ? {orgUnitPath} : {}),
            }),
          }, "directory");
        } catch (error) {
          // An insert may have succeeded before a timeout, or another worker won the race.
          // Re-read ownership before accepting anything; never reset an existing password.
          temporaryPassword = undefined;
          if (!["email-already-exists", "workspace-unavailable"].includes(error.code)) throw error;
          const recovered = await getUser();
          if (recovered.missing) throw error;
          user = requireOwnedUser(recovered, uid, normalized.email, saved.googleUserId);
        }
      }
      requireOwnedUser(user, uid, normalized.email, saved.googleUserId);
      const result = accountResult(user, normalized.email, temporaryPassword);
      const stateSaved = await saveResult(ref, attemptId, result);
      return {...result, ...(stateSaved ? {} : {stateSaved: false})};
    } catch (error) {
      const result = {status: "error", email: normalized ? normalized.email : text(request && request.email), ...safeFailure(error)};
      if (ref && attemptId) await saveResult(ref, attemptId, result);
      return result;
    }
  }

  async function saveResult(ref, attemptId, result) {
    try {
      return await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().attemptId !== attemptId) return false;
        // Explicit allowlist: never spread a response containing a one-time password.
        transaction.set(ref, {
          status: result.status,
          ...(result.googleUserId ? {googleUserId: result.googleUserId} : {}),
          message: result.message,
          errorCode: result.errorCode || null,
          leaseExpiresAt: 0,
          updatedAt: Date.now(),
        }, {merge: true});
        transaction.update(db.collection("users").doc(snapshot.data().uid), {workspaceMailbox: profileSummary(result, snapshot.data().notification)});
        return true;
      });
    } catch {
      // Google may already have created the user. Its ownership marker makes the next retry safe.
      return false;
    }
  }

  return {getStatus, canProvision, validateRequest, checkAvailability, provision};
}

module.exports = {createWorkspaceProvisioning};
