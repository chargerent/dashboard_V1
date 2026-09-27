/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const {createHash} = require("node:crypto");
const nodemailer = require("nodemailer");
const {
  PARTNER_KIT_FILENAME, PARTNER_KIT_PATH, MAX_PARTNER_KIT_BYTES,
  createPartnerKitLoader, preparePartnerKit, validatePartnerKitBuffer,
} = require("./partnerKit");

const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const PREPARED = {attachment: {filename: PARTNER_KIT_FILENAME, content: PDF, contentType: "application/pdf"}, metadata: validatePartnerKitBuffer(PDF)};
const code = fs.readFileSync(require.resolve("./index.js"), "utf8");
const PASSWORD = "Synthetic-dashboard-password-123";

function sourceBetween(startMarker, endMarker) {
  const start = code.indexOf(startMarker);
  const end = code.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, startMarker);
  return code.slice(start, end);
}

function harness({role = "partner", prepare = async () => PREPARED, stream = false, mailResult, auditError = false, clientLogError = false} = {}) {
  const calls = {updates: [], messages: [], transport: [], logs: [], prepared: [], errors: []};
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const senderSource = sourceBetween("async function sendLoginInviteEmail(", "async function appendClientCredentialEmailLog(");
  const sender = new Function("require", "functions", "process", "LOGIN_INVITE_FROM_EMAIL", "LOGIN_INVITE_FROM_NAME", "console", `${senderSource}; return sendLoginInviteEmail;`)(
    (name) => {
      assert.equal(name, "nodemailer");
      return {createTransport: (settings) => {
        calls.transport.push(settings);
        const transport = stream ? nodemailer.createTransport({streamTransport: true, buffer: true, newline: "windows"}) : null;
        return {sendMail: async (message) => {
          calls.messages.push(message);
          return transport ? transport.sendMail(message) : mailResult || {accepted: [message.to], rejected: [], messageId: "synthetic-message-id"};
        }};
      }};
    },
    {https: {HttpsError}}, {env: {GMAIL_APP_PASSWORD: "synthetic-sender-password"}}, "hello@charge.rent", "Chargerent", {error: () => {}},
  );
  const profile = {role, username: "jane.smith", contact: {name: "Jane <Smith>", email: "jane@example.net"}, paymentAdmin: "george"};
  const source = [
    sourceBetween("function escapeHtml(", "function generateLoginPassword("),
    sourceBetween("function buildLoginInviteMessage(", "async function sendLoginInviteEmail("),
    sourceBetween("async function sendLoginInviteImpl(", "const PAYOUT_REPORTS_COLLECTION ="),
  ].join("\n");
  const dependencies = {
    functions: {https: {HttpsError}},
    db: {collection: (name) => ({
      doc: () => ({get: async () => ({exists: true, data: () => profile})}),
      add: async (value) => {
        if (auditError) throw new Error(`Private database diagnostic ${PASSWORD}`);
        calls.logs.push({name, value});
      },
    })},
    admin: {
      auth: () => ({updateUser: async (uid, value) => calls.updates.push({uid, value})}),
      firestore: {FieldValue: {serverTimestamp: () => "server-time"}},
    },
    preparePartnerKit: async (options) => { calls.prepared.push(options); return prepare(options); },
    normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
    isValidUsername: (value) => /^[a-z0-9._-]+$/.test(value),
    isPlainObject: (value) => value && typeof value === "object" && !Array.isArray(value),
    isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    isChargeDropsClientProfile: () => false,
    AUTH_MAPPING_DOMAIN: "dashboard.test",
    LOGIN_INVITE_FROM_NAME: "Chargerent",
    LOGIN_INVITE_CC_ADMINS: {george: "george@charge.rent"},
    getDashboardLoginUrl: () => "https://dashboard.example.test/login",
    generateLoginPassword: () => PASSWORD,
    sendLoginInviteEmail: sender,
    appendClientCredentialEmailLog: async () => {
      if (clientLogError) throw new Error(`Private database diagnostic ${PASSWORD}`);
    },
    console: {error: (...details) => calls.errors.push(details)},
  };
  const invite = new Function(...Object.keys(dependencies), `${source}; return sendLoginInviteImpl;`)(...Object.values(dependencies));
  return {
    calls, sender,
    invite: (data = {}, prepared) => invite({uid: "partner-uid", password: PASSWORD, ...data}, {uid: "admin-uid", profile: {username: "admin"}}, prepared),
  };
}

test("the kit is opt-in, partner-only, and uses a fixed local asset regardless of caller paths", async () => {
  const paths = [];
  let reads = 0;
  let closes = 0;
  const load = createPartnerKitLoader({openFile: async (...args) => {
    paths.push(args);
    return {
      stat: async () => ({isFile: () => true, size: PDF.length}),
      readFile: async () => { reads += 1; return PDF; },
      close: async () => { closes += 1; },
    };
  }});
  for (const includePartnerKit of [undefined, false, "true"]) assert.equal(await load({includePartnerKit, role: "partner"}), null);
  for (const role of ["admin", "user"]) await assert.rejects(load({includePartnerKit: true, role}), {code: "permission-denied"});
  assert.equal(paths.length, 0);
  const kit = await load({includePartnerKit: true, role: "partner", path: "/private/secrets", url: "https://example.test/file.pdf"});
  assert.deepEqual(paths, [[PARTNER_KIT_PATH, "r"]]);
  assert.equal(reads, 1);
  assert.equal(closes, 1);
  assert.deepEqual(kit.metadata, PREPARED.metadata);
  assert.equal(kit.attachment.content, PDF);
  assert.equal(kit.attachment.path, undefined);
});

test("missing, oversized, non-file, and invalid PDF assets fail safely", async () => {
  const missing = createPartnerKitLoader({openFile: async () => { throw new Error("private filesystem path"); }});
  await assert.rejects(missing({includePartnerKit: true, role: "partner"}), (error) => error.code === "failed-precondition" && !error.message.includes("private filesystem path"));
  for (const stat of [{size: MAX_PARTNER_KIT_BYTES + 1, isFile: () => true}, {size: PDF.length, isFile: () => false}]) {
    let read = false;
    let closed = false;
    const load = createPartnerKitLoader({openFile: async () => ({
      stat: async () => stat, readFile: async () => { read = true; return PDF; }, close: async () => { closed = true; },
    })});
    await assert.rejects(load({includePartnerKit: true, role: "partner"}), {code: "failed-precondition"});
    assert.equal(read, false);
    assert.equal(closed, true);
  }
  for (const content of [Buffer.from("not a PDF"), Buffer.from("%PDF-1.7\ntruncated document without an EOF marker"), Buffer.alloc(MAX_PARTNER_KIT_BYTES + 1)]) {
    assert.throws(() => validatePartnerKitBuffer(content), {code: "failed-precondition"});
  }
});

test("existing partner invite combines credentials and the fixed PDF into one Gmail message", async () => {
  const {invite, calls} = harness();
  const result = await invite({includePartnerKit: true, attachmentPath: "/private/secrets", attachments: [{path: "/private/secrets"}]});
  assert.equal(result.partnerKitIncluded, true);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.updates.length, 1);
  const message = calls.messages[0];
  assert.equal(message.from, "Chargerent <hello@charge.rent>");
  assert.equal(message.to, "jane@example.net");
  assert.equal(message.cc, "george@charge.rent");
  assert.match(message.subject, /dashboard login and partner launch kit/);
  assert.ok(message.text.includes(PASSWORD));
  assert.match(message.text, /Partner Launch Kit is attached/);
  assert.ok(message.html.includes("Jane &lt;Smith&gt;"));
  assert.match(message.html, /Partner Launch Kit is attached/);
  assert.deepEqual(message.attachments, [PREPARED.attachment]);
  assert.equal(calls.transport[0].host, "smtp.gmail.com");
  assert.equal(calls.logs[0].value.partnerKitIncluded, true);
  assert.deepEqual(calls.logs[0].value.partnerKit, PREPARED.metadata);
  assert.equal(JSON.stringify(calls.logs).includes(PASSWORD), false);
  assert.equal(JSON.stringify(calls.logs).includes('"content"'), false);
});

test("an already preflighted creation attachment is reused without a second file read", async () => {
  const {invite, calls} = harness({prepare: async () => { throw new Error("unexpected reload"); }});
  assert.equal((await invite({includePartnerKit: true}, PREPARED)).partnerKitIncluded, true);
  assert.equal(calls.prepared.length, 0);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].attachments[0].content, PDF);
});

test("CC acceptance or missing SMTP confirmation cannot claim the partner received the kit email", async () => {
  for (const mailResult of [
    {accepted: ["george@charge.rent"], rejected: ["jane@example.net"], messageId: "cc-only-id"},
    {accepted: ["jane@example.net"], rejected: ["jane@example.net"]},
    {messageId: "unconfirmed-id"},
  ]) {
    const {invite, calls} = harness({mailResult});
    await assert.rejects(invite({includePartnerKit: true}), {code: "unavailable"});
    assert.equal(calls.messages.length, 1);
    assert.equal(calls.logs.length, 0);
  }
});

test("post-send audit failures preserve confirmed kit success and log only the account ID", async () => {
  const {invite, calls} = harness({auditError: true, clientLogError: true});
  const result = await invite({includePartnerKit: true});
  assert.equal(result.ok, true);
  assert.equal(result.partnerKitIncluded, true);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.errors.length, 2);
  assert.deepEqual(calls.errors.map((entry) => entry[1]), [{uid: "partner-uid"}, {uid: "partner-uid"}]);
  assert.equal(JSON.stringify(calls.errors).includes(PASSWORD), false);
});

test("missing kit or ineligible recipient cannot reset the password or send an invite", async () => {
  const missing = harness({prepare: async () => { throw Object.assign(new Error("The kit is unavailable"), {code: "failed-precondition"}); }});
  await assert.rejects(missing.invite({includePartnerKit: true}), {code: "failed-precondition"});
  assert.equal(missing.calls.updates.length, 0);
  assert.equal(missing.calls.messages.length, 0);
  for (const role of ["admin", "user"]) {
    const denied = harness({role});
    await assert.rejects(denied.invite({includePartnerKit: true}), {code: "permission-denied"});
    assert.equal(denied.calls.updates.length, 0);
    assert.equal(denied.calls.messages.length, 0);
    assert.equal(denied.calls.prepared.length, 0);
  }
});

test("ordinary credentials and Workspace address notices remain attachment-free", async () => {
  const {invite, calls, sender} = harness({role: "admin", prepare: async () => { throw new Error("unexpected load"); }});
  assert.equal((await invite()).partnerKitIncluded, false);
  assert.equal(calls.messages[0].attachments, undefined);
  assert.equal(calls.messages[0].subject, "Your Chargerent dashboard login");
  assert.equal(calls.messages[0].text.includes("kit"), false);
  await sender({to: "partner@example.net", subject: "Your company address", body: "Address only", html: "<p>Address only</p>"});
  assert.equal(calls.messages[1].attachments, undefined);
  assert.equal(calls.prepared.length, 0);
});

test("the real bundled kit survives actual Nodemailer MIME encoding with its exact verified SHA256", async () => {
  const kit = await preparePartnerKit({includePartnerKit: true, role: "partner"});
  assert.equal(kit.metadata.sizeBytes, 6512678);
  assert.equal(kit.metadata.sha256, "b3ce849625b6d3505e69daa06ceb98fed57b8b0ea508cb153aff960787234491");
  const {sender, calls} = harness({stream: true});
  const result = await sender({
    to: "synthetic-recipient@example.net", cc: "synthetic-cc@example.net",
    subject: "Local test: dashboard credentials and partner launch kit",
    body: `Username: synthetic-user\nPassword: ${PASSWORD}\nPartner launch kit attached.`,
    html: "<p>Synthetic local email verification.</p>", attachments: [kit.attachment],
  });
  assert.equal(calls.messages.length, 1);
  const mime = result.message.toString("ascii");
  const headerStart = mime.indexOf("Content-Type: application/pdf");
  assert.ok(headerStart >= 0);
  const headerEnd = mime.indexOf("\r\n\r\n", headerStart);
  const headers = mime.slice(headerStart, headerEnd).replace(/\r\n[ \t]+/g, " ");
  assert.ok(headers.includes(`filename=${PARTNER_KIT_FILENAME}`) || headers.includes(`filename="${PARTNER_KIT_FILENAME}"`));
  assert.ok(headers.includes("Content-Transfer-Encoding: base64"));
  assert.ok(headers.includes("Content-Disposition: attachment"));
  const bodyEnd = mime.indexOf("\r\n--", headerEnd + 4);
  assert.ok(bodyEnd > headerEnd);
  const decoded = Buffer.from(mime.slice(headerEnd + 4, bodyEnd), "base64");
  assert.equal(decoded.length, kit.metadata.sizeBytes);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), kit.metadata.sha256);
  assert.deepEqual(decoded, fs.readFileSync(PARTNER_KIT_PATH));
});
