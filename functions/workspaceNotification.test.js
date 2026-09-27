/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const {createWorkspaceNotification, isValidWorkspaceContactEmail} = require("./workspaceNotification");

const UID = "partner-uid";
const RECORD_PATH = `workspaceProvisioning/${UID}`;
const PROFILE_PATH = `users/${UID}`;
const RECIPIENT = "partner@example.net";
const COMPANY_EMAIL = "j.smith@charge.rent";
const MAILBOX = {status: "ready", email: COMPANY_EMAIL, googleUserId: "google-user-1", temporaryPassword: "never-send-google-password"};
const RECORD = {
  uid: UID, status: "ready", email: COMPANY_EMAIL, googleUserId: "google-user-1",
  contactEmail: RECIPIENT,
  request: {role: "partner", email: COMPANY_EMAIL, givenName: "Jane", familyName: "Smith"},
};

function fakeDb(record = RECORD) {
  const records = new Map([
    [RECORD_PATH, structuredClone(record)],
    [PROFILE_PATH, {role: "partner", workspaceMailbox: {status: "ready", email: COMPANY_EMAIL}}],
  ]);
  const writes = [];
  const failures = new Set();
  const failuresAfterCommit = new Set();
  let transactionNumber = 0;
  let queue = Promise.resolve();
  return {
    records, writes, failures, failuresAfterCommit,
    collection: (name) => ({doc: (uid) => ({path: `${name}/${uid}`})}),
    runTransaction(handler) {
      const operation = queue.then(async () => {
        transactionNumber += 1;
        if (failures.has(transactionNumber)) throw new Error("simulated database failure");
        const changes = [];
        const value = await handler({
          async get(ref) {
            return {exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path))};
          },
          update(ref, data) {
            assert.ok(records.has(ref.path));
            changes.push({path: ref.path, data: structuredClone(data)});
          },
        });
        for (const change of changes) {
          writes.push(change);
          const updated = structuredClone(records.get(change.path));
          for (const [key, next] of Object.entries(change.data)) {
            const parts = key.split(".");
            let target = updated;
            for (const part of parts.slice(0, -1)) target = target[part] ||= {};
            target[parts.at(-1)] = next;
          }
          records.set(change.path, updated);
        }
        if (failuresAfterCommit.has(transactionNumber)) throw new Error("simulated lost commit acknowledgement");
        return value;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

test("contact email validation matches the frontend's strict syntax and length boundaries", () => {
  for (const value of [
    "partner@example.net", " First.Last+partner@sub.example.net ",
    `${"a".repeat(64)}@example.net`, `a@${"b".repeat(63)}.net`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  ]) assert.equal(isValidWorkspaceContactEmail(value), true, value);
  for (const value of [
    undefined, null, 123, "", "@example.net", "partner@", "partner", "partner@@example.net",
    ".partner@example.net", "partner.@example.net", "part..ner@example.net",
    "partner@example..net", "partner@.example.net", "partner@example.net.",
    "partner@-example.net", "partner@example-.net", "part ner@example.net", "partner@example net",
    "partner@example.net\r\nBcc: injected@example.net", "Partner <partner@example.net>",
    `${"a".repeat(65)}@example.net`, `a@${"b".repeat(64)}.net`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  ]) assert.equal(isValidWorkspaceContactEmail(value), false, String(value));
  assert.equal(isValidWorkspaceContactEmail(" J.SMITH@charge.rent ", {companyEmail: COMPANY_EMAIL}), false);
  assert.equal(isValidWorkspaceContactEmail(RECIPIENT, {companyEmail: COMPANY_EMAIL}), true);
});

function setup({record = RECORD, sendEmail, now = () => 10000, leaseMs = 1000} = {}) {
  const db = fakeDb(record);
  const calls = [];
  const service = createWorkspaceNotification({
    db, now, leaseMs,
    sendEmail: async (message) => {
      calls.push(message);
      return sendEmail ? sendEmail(message) : {accepted: [RECIPIENT], rejected: [], messageId: "<notice-id@gmail.test>"};
    },
  });
  return {db, calls, notify: (overrides = {}) => service.notify({uid: UID, actorUid: "trusted-admin", mailbox: MAILBOX, ...overrides})};
}

test("sends only the company address and sign-in notice to the frozen contact", async () => {
  const {notify, calls, db} = setup();
  const result = await notify({recipient: "attacker@example.net", contactEmail: "attacker@example.net", sendNotification: false});
  assert.equal(result.notificationStatus, "sent");
  assert.equal(result.notificationEmail, RECIPIENT);
  assert.match(result.notificationMessage, /^Company address email sent/);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["body", "html", "subject", "to"]);
  assert.equal(calls[0].to, RECIPIENT);
  assert.match(calls[0].body, /Hi Jane Smith/);
  assert.ok(calls[0].body.includes(COMPANY_EMAIL));
  assert.ok(calls[0].body.includes("https://mail.google.com/"));
  assert.match(calls[0].body, /sign-in details will be supplied separately/);
  assert.equal(JSON.stringify({calls, writes: db.writes, result}).includes(MAILBOX.temporaryPassword), false);
  assert.equal(JSON.stringify(calls).includes("attacker@example.net"), false);
  const saved = db.records.get(RECORD_PATH).notification;
  assert.equal(saved.status, "sent");
  assert.equal(saved.messageId, "<notice-id@gmail.test>");
  const profile = db.records.get(PROFILE_PATH).workspaceMailbox;
  assert.equal(profile.status, "ready");
  assert.equal(profile.email, COMPANY_EMAIL);
  assert.equal(profile.notificationStatus, "sent");
  assert.equal(profile.notificationEmail, RECIPIENT);
});

test("notifications reject missing, malformed, or new-mailbox contact addresses", async () => {
  for (const contactEmail of ["", "not-an-email", COMPANY_EMAIL, "partner@example.net\r\nBcc: other@example.net"]) {
    const {notify, calls, db} = setup({record: {...RECORD, contactEmail}});
    assert.equal((await notify()).notificationStatus, "error");
    assert.equal(calls.length, 0);
    assert.equal(db.writes.length, 0);
  }
});

test("notifications require matching confirmed Google account evidence", async () => {
  const variants = [
    {mailbox: {...MAILBOX, status: "error"}},
    {mailbox: {...MAILBOX, googleUserId: "wrong-user"}},
    {mailbox: {...MAILBOX, email: "forged@charge.rent"}},
    {mailbox: {...MAILBOX, googleUserId: undefined}},
  ];
  for (const variant of variants) {
    const {notify, calls} = setup();
    assert.equal((await notify(variant)).notificationStatus, "pending");
    assert.equal(calls.length, 0);
  }
  for (const record of [{...RECORD, status: "error"}, {...RECORD, googleUserId: ""}, {...RECORD, request: {...RECORD.request, email: "other@charge.rent"}}]) {
    const {notify, calls} = setup({record});
    assert.equal((await notify()).notificationStatus, "pending");
    assert.equal(calls.length, 0);
  }
});

test("recipient must remain a partner in both the saved request and current profile", async () => {
  for (const role of ["admin", "user"]) {
    const changedRequest = setup({record: {...RECORD, request: {...RECORD.request, role}}});
    assert.equal((await changedRequest.notify()).notificationStatus, "error");
    assert.equal(changedRequest.calls.length, 0);
    const changedProfile = setup();
    changedProfile.db.records.get(PROFILE_PATH).role = role;
    assert.equal((await changedProfile.notify()).notificationStatus, "error");
    assert.equal(changedProfile.calls.length, 0);
  }
});

test("pending Gmail activation is accurately described and names are HTML escaped", async () => {
  const {notify, calls} = setup({record: {...RECORD, status: "pending", request: {...RECORD.request, givenName: '<Jane & "J">', familyName: "O'Smith"}}});
  assert.equal((await notify({mailbox: {...MAILBOX, status: "pending"}})).notificationStatus, "sent");
  assert.match(calls[0].body, /Gmail activation is still pending/);
  assert.ok(calls[0].html.includes("&lt;Jane &amp; &quot;J&quot;&gt; O&#39;Smith"));
  assert.equal(calls[0].html.includes('<Jane & "J">'), false);
});

test("the saved Google status controls activation wording instead of the caller", async () => {
  const {notify, calls} = setup({record: {...RECORD, status: "pending"}});
  assert.equal((await notify()).notificationStatus, "sent");
  assert.match(calls[0].body, /Gmail activation is still pending/);
});

test("a completed notice is not sent again on repeated status refreshes, including resend flags", async () => {
  const {notify, calls} = setup();
  await notify();
  for (const resendUnknown of [false, true]) assert.equal((await notify({resendUnknown})).notificationStatus, "sent");
  assert.equal(calls.length, 1);
});

test("concurrent attempts send one notice only", async () => {
  let release;
  let began;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { began = resolve; });
  const {notify, calls} = setup({sendEmail: async () => {
    began();
    await wait;
    return {accepted: [RECIPIENT], rejected: []};
  }});
  const first = notify();
  await started;
  assert.equal((await notify()).notificationStatus, "pending");
  assert.equal((await notify({resendUnknown: true})).notificationStatus, "pending");
  release();
  assert.equal((await first).notificationStatus, "sent");
  assert.equal(calls.length, 1);
});

test("a failed pre-send transaction sends nothing and can be retried", async () => {
  const {notify, calls, db} = setup();
  db.failures.add(1);
  assert.equal((await notify()).notificationStatus, "error");
  assert.equal(calls.length, 0);
  assert.equal((await notify()).notificationStatus, "sent");
  assert.equal(calls.length, 1);
});

test("known pre-send and recipient rejection failures can be retried without confirmation", async () => {
  for (const properties of [
    {code: "failed-precondition"}, {code: "EAUTH"}, {code: "EENVELOPE"}, {code: "internal", notificationBeforeSend: true},
    {code: "ETIMEDOUT", command: "CONN"}, {command: "DATA", responseCode: 550},
  ]) {
    let attempts = 0;
    const {notify, calls, db} = setup({sendEmail: async () => {
      if (++attempts === 1) throw Object.assign(new Error("private raw provider secret"), properties);
      return {accepted: [RECIPIENT], rejected: []};
    }});
    assert.equal((await notify()).notificationStatus, "error");
    assert.equal((await notify()).notificationStatus, "sent");
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(db.writes).includes("private raw provider secret"), false);
  }
});

test("resolved recipient rejection is a safe error and accepted requires the intended recipient", async () => {
  const rejected = setup({sendEmail: async () => ({accepted: [], rejected: [RECIPIENT]})});
  assert.equal((await rejected.notify()).notificationStatus, "error");
  for (const reply of [{messageId: "only-id"}, {accepted: ["other@example.net"], rejected: []}, {accepted: [RECIPIENT], rejected: [RECIPIENT]}]) {
    const {notify} = setup({sendEmail: async () => reply});
    assert.equal((await notify()).notificationStatus, "unknown");
  }
});

test("ambiguous SMTP failures block automatic retries and require a literal confirmed resend", async () => {
  let attempts = 0;
  const {notify, calls, db} = setup({sendEmail: async () => {
    if (++attempts === 1) throw Object.assign(new Error("private data"), {code: "ETIMEDOUT", command: "DATA"});
    return {accepted: [RECIPIENT], rejected: []};
  }});
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal((await notify({resendUnknown: "true"})).notificationStatus, "unknown");
  assert.equal(calls.length, 1);
  assert.equal((await notify({resendUnknown: true})).notificationStatus, "sent");
  assert.equal(calls.length, 2);
  assert.equal(db.records.get(RECORD_PATH).notification.resendConfirmedAt, 10000);
  assert.equal(JSON.stringify(db.writes).includes("private data"), false);
});

test("expired sending leases become unknown instead of automatically resending", async () => {
  const notification = {status: "pending", phase: "sending", recipient: RECIPIENT, attemptId: "old-attempt", leaseExpiresAt: 1000};
  const {notify, calls, db} = setup({record: {...RECORD, notification}});
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal(calls.length, 0);
  assert.equal(db.records.get(RECORD_PATH).notification.status, "unknown");
  assert.equal((await notify({resendUnknown: true})).notificationStatus, "sent");
  assert.equal(calls.length, 1);
});

test("a post-send persistence failure is unknown and never automatically duplicates", async () => {
  const {notify, calls, db} = setup();
  db.failures.add(2);
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal(db.records.get(RECORD_PATH).notification.status, "unknown");
  assert.equal(db.records.get(RECORD_PATH).notification.messageId, "<notice-id@gmail.test>");
  assert.equal(db.records.get(RECORD_PATH).notification.smtpAcceptedAt, 10000);
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal(calls.length, 1);
});

test("a verified sent commit survives a lost database acknowledgement without losing sent metadata", async () => {
  const {notify, calls, db} = setup();
  db.failuresAfterCommit.add(2);
  assert.equal((await notify()).notificationStatus, "sent");
  const saved = db.records.get(RECORD_PATH).notification;
  assert.equal(saved.status, "sent");
  assert.equal(saved.messageId, "<notice-id@gmail.test>");
  assert.equal(saved.sentAt, 10000);
  assert.equal((await notify({resendUnknown: true})).notificationStatus, "sent");
  assert.equal(calls.length, 1);
});

test("a verified pre-send failure commit remains safely retryable after a lost acknowledgement", async () => {
  let attempts = 0;
  const {notify, calls, db} = setup({sendEmail: async () => {
    if (++attempts === 1) throw Object.assign(new Error("authentication rejected"), {code: "EAUTH"});
    return {accepted: [RECIPIENT], rejected: []};
  }});
  db.failuresAfterCommit.add(2);
  assert.equal((await notify()).notificationStatus, "error");
  assert.equal(db.records.get(RECORD_PATH).notification.status, "error");
  assert.equal((await notify()).notificationStatus, "sent");
  assert.equal(calls.length, 2);
});

test("if all post-send state writes fail, the sending lease still blocks a duplicate", async () => {
  const {notify, calls, db} = setup();
  db.failures.add(2);
  db.failures.add(3);
  assert.equal((await notify()).notificationStatus, "unknown");
  assert.equal((await notify()).notificationStatus, "pending");
  assert.equal(calls.length, 1);
});

test("notification intent cannot silently change recipients or account identity", async () => {
  for (const notification of [{recipient: "old@example.net"}, {accountEmail: "other@charge.rent"}, {googleUserId: "old-google-user"}]) {
    const {notify, calls, db} = setup({record: {...RECORD, notification}});
    assert.equal((await notify({resendUnknown: true})).notificationStatus, "error");
    assert.equal(calls.length, 0);
    assert.equal(db.writes.length, 0);
  }
});
