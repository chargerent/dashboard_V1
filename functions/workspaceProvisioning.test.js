/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const {createWorkspaceProvisioning} = require("./workspaceProvisioning");

const ENV = {
  WORKSPACE_PROVISIONING_ENABLED: "true",
  WORKSPACE_DOMAIN: "charge.rent",
  WORKSPACE_ADMIN_EMAIL: "workspace-admin@charge.rent",
  WORKSPACE_SERVICE_ACCOUNT_EMAIL: "workspace-provisioner@test-project.iam.gserviceaccount.com",
  WORKSPACE_DASHBOARD_ADMIN_UIDS: "trusted-admin, another-admin",
};
const REQUEST = {
  localPart: "g.gazelian",
  givenName: "George",
  familyName: "Gazelian",
  recoveryEmail: "existing@example.com",
  role: "partner",
};

function fakeDb() {
  const records = new Map([["users/dashboard-user", {displayName: "Existing dashboard account"}]]);
  const writes = [];
  let transactionQueue = Promise.resolve();
  return {
    records,
    writes,
    collection: (collection) => ({doc: (id) => ({path: `${collection}/${id}`})}),
    runTransaction(handler) {
      const operation = transactionQueue.then(async () => {
        const pendingWrites = [];
        const result = await handler({
          async get(ref) {
            const value = records.get(ref.path);
            return {exists: Boolean(value), data: () => structuredClone(value)};
          },
          set(ref, value, options) { pendingWrites.push({ref, value: structuredClone(value), options}); },
          update(ref, value) {
            assert.ok(records.has(ref.path), `Document must exist: ${ref.path}`);
            pendingWrites.push({ref, value: structuredClone(value), options: {merge: true}});
          },
        });
        pendingWrites.forEach(({ref, value, options}) => {
          writes.push(value);
          records.set(ref.path, options && options.merge ? {...records.get(ref.path), ...value} : value);
        });
        return result;
      });
      transactionQueue = operation.catch(() => {});
      return operation;
    },
  };
}

function response(status, body) {
  return {ok: status >= 200 && status < 300, status, json: async () => body};
}

function ownedUser(overrides = {}) {
  return {
    id: "google-user-123",
    primaryEmail: "g.gazelian@charge.rent",
    isMailboxSetup: true,
    externalIds: [{type: "custom", customType: "dashboardUid", value: "dashboard-user"}],
    ...overrides,
  };
}

function setup({env = ENV, directory, db = fakeDb()} = {}) {
  const calls = [];
  let user = null;
  const fetchImpl = async (url, options) => {
    calls.push({url, ...options});
    if (url.includes(":signJwt")) return response(200, {signedJwt: "private-jwt"});
    if (url === "https://oauth2.googleapis.com/token") return response(200, {access_token: "private-delegated-token", expires_in: 3600});
    if (directory) return directory(url, options);
    if (options.method === "GET") return user ? response(200, user) : response(404, {});
    user = ownedUser();
    return response(200, user);
  };
  const admin = {app: () => ({options: {credential: {getAccessToken: async () => ({access_token: "private-runtime-token"})}}})};
  const service = createWorkspaceProvisioning({admin, db, fetchImpl, env});
  return {
    service,
    calls,
    db,
    provision: (overrides = {}) => service.provision({uid: "dashboard-user", request: REQUEST, actorUid: "trusted-admin", ...overrides}),
  };
}

test("availability requires complete enabled config and a trusted server-side administrator", async () => {
  for (const config of [
    {}, {...ENV, WORKSPACE_PROVISIONING_ENABLED: "false"},
    {...ENV, WORKSPACE_ADMIN_EMAIL: ""}, {...ENV, WORKSPACE_SERVICE_ACCOUNT_EMAIL: ""},
    {...ENV, WORKSPACE_DASHBOARD_ADMIN_UIDS: ""}, {...ENV, WORKSPACE_DOMAIN: "invalid"},
  ]) {
    const {service, calls} = setup({env: config});
    assert.equal(service.getStatus().enabled, false);
    assert.throws(() => service.validateRequest(REQUEST, {role: "partner"}), {code: "failed-precondition"});
    assert.equal(calls.length, 0);
  }
  const {service, provision, calls, db} = setup();
  assert.equal(service.getStatus().enabled, true);
  assert.equal(service.canProvision("another-admin"), true);
  assert.equal(service.canProvision("profile-role-admin"), false);
  assert.equal((await provision({actorUid: "profile-role-admin"})).errorCode, "permission-denied");
  await assert.rejects(service.checkAvailability("g.gazelian", {actorUid: "profile-role-admin"}), {code: "permission-denied"});
  assert.equal(calls.length, 0);
  assert.equal(db.writes.length, 0);
});

test("request validation restricts roles, company domain, names, and recovery addresses", () => {
  const {service} = setup();
  assert.equal(service.validateRequest({...REQUEST, localPart: " G.Gazelian "}, {role: "partner"}).email, "g.gazelian@charge.rent");
  for (const role of ["admin", "user", "client"]) {
    assert.throws(() => service.validateRequest(REQUEST, {role}), {code: "permission-denied"});
  }
  for (const change of [
    {localPart: "x@elsewhere.com"}, {email: "g.gazelian@elsewhere.com"},
    {localPart: "g+gazelian"}, {localPart: "g..gazelian"}, {localPart: "a".repeat(65)},
    {givenName: ""}, {familyName: " "}, {givenName: "a".repeat(61)},
    {recoveryEmail: "invalid"}, {recoveryEmail: "g.gazelian@charge.rent"},
  ]) {
    assert.throws(() => service.validateRequest({...REQUEST, ...change}, {role: "partner"}), {code: "invalid-argument"});
  }
});

test("authorized administrators cannot provision company email for admin or ordinary-user recipients", async () => {
  for (const role of ["admin", "user"]) {
    const {provision, calls, db} = setup();
    const result = await provision({request: {...REQUEST, role}});
    assert.equal(result.errorCode, "permission-denied");
    assert.equal(calls.length, 0);
    assert.equal(db.writes.length, 0);
  }
});

test("availability performs a read-only Directory lookup and propagates authorization failure safely", async () => {
  const available = setup();
  assert.deepEqual(await available.service.checkAvailability("g.gazelian", {actorUid: "trusted-admin"}), {available: true, email: "g.gazelian@charge.rent"});
  assert.equal(available.calls.filter((call) => call.url.includes("admin.googleapis.com") && call.method === "POST").length, 0);
  const taken = setup({directory: async () => response(200, {id: "someone-else"})});
  assert.equal((await taken.service.checkAvailability("g.gazelian", {actorUid: "trusted-admin"})).available, false);
  const denied = setup({directory: async () => response(403, {secret: "do-not-return-this"})});
  await assert.rejects(denied.service.checkAvailability("g.gazelian", {actorUid: "trusted-admin"}), (error) => error.code === "workspace-authorization-required" && !error.message.includes("do-not-return-this"));
});

test("creates a normal Google user with independent password and never persists secrets", async () => {
  const {service, provision, calls, db} = setup({env: {...ENV, WORKSPACE_ORG_UNIT_PATH: "/Partners"}});
  const result = await provision();
  assert.equal(result.status, "ready");
  assert.ok(result.temporaryPassword.length >= 32);
  const insert = calls.find((call) => call.url === "https://admin.googleapis.com/admin/directory/v1/users" && call.method === "POST");
  const body = JSON.parse(insert.body);
  assert.equal(body.password, result.temporaryPassword);
  assert.equal(body.changePasswordAtNextLogin, true);
  assert.equal(body.recoveryEmail, REQUEST.recoveryEmail);
  assert.equal(body.orgUnitPath, "/Partners");
  assert.deepEqual(body.externalIds, [{type: "custom", customType: "dashboardUid", value: "dashboard-user"}]);
  assert.equal(body.isAdmin, undefined);
  assert.equal(body.isDelegatedAdmin, undefined);
  const jwt = JSON.parse(JSON.parse(calls.find((call) => call.url.includes(":signJwt")).body).payload);
  assert.equal(jwt.sub, ENV.WORKSPACE_ADMIN_EMAIL);
  assert.equal(jwt.scope, "https://www.googleapis.com/auth/admin.directory.user");
  assert.equal(jwt.exp - jwt.iat, 3600);
  const record = db.records.get("workspaceProvisioning/dashboard-user");
  assert.deepEqual(record.request, service.validateRequest(REQUEST, {role: "partner"}));
  assert.equal(record.googleUserId, "google-user-123");
  const profile = db.records.get("users/dashboard-user");
  assert.equal(profile.displayName, "Existing dashboard account");
  assert.deepEqual(profile.workspaceMailbox, {
    status: "ready", email: "g.gazelian@charge.rent", googleUserId: "google-user-123",
    message: "Google confirms that the mailbox is set up.",
  });
  assert.equal(Object.hasOwn(profile.workspaceMailbox, "passwordAvailable"), false);
  const persisted = JSON.stringify(db.writes);
  for (const secret of [result.temporaryPassword, "private-jwt", "private-delegated-token", "private-runtime-token"]) {
    assert.equal(persisted.includes(secret), false);
  }
  assert.equal(persisted.includes('"password"'), false);
});

test("retry uses the immutable Google ID and never recreates or resets a password", async () => {
  const {provision, calls} = setup();
  await provision();
  const repeated = await provision();
  assert.equal(repeated.status, "ready");
  assert.equal(repeated.temporaryPassword, undefined);
  assert.equal(repeated.passwordRecoveryRequired, true);
  assert.match(repeated.passwordMessage, /cannot be shown again/);
  assert.ok(calls.some((call) => call.url.includes("/users/google-user-123?")));
  assert.equal(calls.filter((call) => call.url === "https://admin.googleapis.com/admin/directory/v1/users" && call.method === "POST").length, 1);
});

test("status retries preserve sent and failed notification summaries without exposing private notification state", async () => {
  for (const status of ["sent", "error"]) {
    const {provision, calls, db} = setup();
    await provision();
    const notification = {
      status,
      recipient: "partner@example.com",
      message: status === "sent" ? "The company address email was sent." : "The company address email was rejected.",
      messageId: "private-message-id",
      attemptId: "private-notification-attempt",
      phase: "complete",
    };
    db.records.get("workspaceProvisioning/dashboard-user").notification = structuredClone(notification);
    const firstRetryWrite = db.writes.length;

    const result = await provision();

    assert.equal(result.status, "ready");
    const profileWrites = db.writes.slice(firstRetryWrite).filter((write) => write.workspaceMailbox);
    assert.deepEqual(profileWrites.map((write) => write.workspaceMailbox.status), ["provisioning", "ready"]);
    for (const {workspaceMailbox} of profileWrites) {
      assert.equal(workspaceMailbox.notificationStatus, status);
      assert.equal(workspaceMailbox.notificationEmail, notification.recipient);
      assert.equal(workspaceMailbox.notificationMessage, notification.message);
      const visible = JSON.stringify(workspaceMailbox);
      assert.equal(visible.includes(notification.messageId), false);
      assert.equal(visible.includes(notification.attemptId), false);
    }
    assert.equal(db.records.get("users/dashboard-user").workspaceMailbox.notificationStatus, status);
    assert.deepEqual(db.records.get("workspaceProvisioning/dashboard-user").notification, notification);
    assert.equal(calls.filter((call) => call.url === "https://admin.googleapis.com/admin/directory/v1/users" && call.method === "POST").length, 1);
  }
});

test("existing unowned user is neither adopted nor changed", async () => {
  for (const externalIds of [[], [{type: "custom", customType: "dashboardUid", value: "someone-else"}]]) {
    const {provision, calls} = setup({directory: async () => response(200, ownedUser({externalIds}))});
    const result = await provision();
    assert.equal(result.status, "error");
    assert.equal(result.errorCode, "email-already-exists");
    assert.equal(calls.filter((call) => call.url.includes("admin.googleapis.com") && call.method !== "GET").length, 0);
  }
});

test("concurrent attempts claim a single creation and report the running attempt", async () => {
  let release;
  let reachedGet;
  const blocked = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { reachedGet = resolve; });
  let insertCount = 0;
  const {provision} = setup({directory: async (_url, options) => {
    if (options.method === "GET") {
      reachedGet();
      await blocked;
      return response(404, {});
    }
    insertCount += 1;
    return response(200, ownedUser());
  }});
  const first = provision();
  await reached;
  const duplicate = await provision();
  assert.equal(duplicate.status, "provisioning");
  release();
  assert.equal((await first).status, "ready");
  assert.equal(insertCount, 1);
});

test("new account reports Gmail activation separately", async () => {
  const {provision} = setup({directory: async (_url, options) => options.method === "GET" ? response(404, {}) : response(200, ownedUser({isMailboxSetup: false}))});
  const result = await provision();
  assert.equal(result.status, "pending");
  assert.equal(result.googleUserId, "google-user-123");
  assert.ok(result.temporaryPassword);
  assert.match(result.message, /license/);
});

test("a recovery email is optional and omitted from Google when blank", async () => {
  const {provision, calls} = setup();
  const result = await provision({request: {...REQUEST, recoveryEmail: ""}});
  assert.equal(result.status, "ready");
  const insert = calls.find((call) => call.url === "https://admin.googleapis.com/admin/directory/v1/users" && call.method === "POST");
  assert.equal(Object.hasOwn(JSON.parse(insert.body), "recoveryEmail"), false);
});

test("a lost insert response recovers only the matching ownership marker without replaying password", async () => {
  let created = false;
  let inserts = 0;
  const {provision, db} = setup({directory: async (_url, options) => {
    if (options.method === "GET") return created ? response(200, ownedUser()) : response(404, {});
    inserts += 1;
    created = true;
    throw new Error("simulated connection loss containing secret");
  }});
  const result = await provision();
  assert.equal(result.status, "ready");
  assert.equal(result.temporaryPassword, undefined);
  assert.equal(result.passwordRecoveryRequired, true);
  assert.equal(inserts, 1);
  assert.equal(JSON.stringify(db.writes).includes("simulated connection"), false);
});

test("insert collision caused by another account never adopts that account", async () => {
  let reads = 0;
  const {provision} = setup({directory: async (_url, options) => {
    if (options.method === "GET") return ++reads === 1 ? response(404, {}) : response(200, ownedUser({externalIds: []}));
    return response(409, {});
  }});
  const result = await provision();
  assert.equal(result.errorCode, "email-already-exists");
  assert.equal(result.temporaryPassword, undefined);
});

test("API failures are safe errors and keep dashboard creation separate", async () => {
  const {provision, db} = setup({directory: async () => response(403, {error: "sensitive delegated account diagnostic"})});
  const result = await provision();
  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "workspace-authorization-required");
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
  assert.equal(db.records.get("workspaceProvisioning/dashboard-user").status, "error");
});

test("saved Google ID prevents recreation after deletion or silent linkage after rename", async () => {
  for (const user of [null, ownedUser({primaryEmail: "renamed@charge.rent"})]) {
    let created = false;
    let inserts = 0;
    const {provision} = setup({directory: async (_url, options) => {
      if (options.method === "POST") { created = true; inserts += 1; return response(200, ownedUser()); }
      return created && user ? response(200, user) : response(404, {});
    }});
    await provision();
    const result = await provision();
    assert.equal(result.errorCode, user ? "workspace-account-changed" : "workspace-account-missing");
    assert.equal(inserts, 1);
  }
});

test("retry cannot switch addresses after an uncertain attempt", async () => {
  const {provision, calls} = setup({directory: async () => response(503, {})});
  await provision();
  const callsBefore = calls.length;
  const result = await provision({request: {...REQUEST, localPart: "other.address"}});
  assert.equal(result.errorCode, "workspace-request-changed");
  assert.equal(calls.length, callsBefore);
});

test("a failed final state write preserves the immediate one-time password and retries safely", async () => {
  const db = fakeDb();
  const transaction = db.runTransaction.bind(db);
  let transactionCount = 0;
  db.runTransaction = (handler) => {
    transactionCount += 1;
    if (transactionCount === 2) return Promise.reject(new Error("simulated persistence loss"));
    return transaction(handler);
  };
  const {provision, calls} = setup({db});
  const result = await provision();
  assert.equal(result.status, "ready");
  assert.ok(result.temporaryPassword);
  assert.equal(result.stateSaved, false);
  db.records.get("workspaceProvisioning/dashboard-user").leaseExpiresAt = 0;
  const retry = await provision();
  assert.equal(retry.status, "ready");
  assert.equal(retry.temporaryPassword, undefined);
  assert.equal(calls.filter((call) => call.url === "https://admin.googleapis.com/admin/directory/v1/users" && call.method === "POST").length, 1);
});
