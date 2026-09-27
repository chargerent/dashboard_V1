/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {GMAIL_SEND_SCOPE, buildRawMessage, createGmailApiSender} = require("./gmailApiSender");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function fakeAdmin() {
  return {
    app() {
      return {
        options: {
          projectId: "node-red-alerts",
          credential: {
            async getAccessToken() {
              return {access_token: "cloud-token"};
            },
          },
        },
      };
    },
    credential: {
      applicationDefault() {
        throw new Error("not needed");
      },
    },
  };
}

test("buildRawMessage produces safe multipart email content", () => {
  const message = buildRawMessage({
    fromName: "Chargerent Customer Support",
    fromEmail: "support@charge.rent",
    replyTo: "support@charge.rent",
    to: "customer@example.com",
    subject: "Refund update\r\nBcc: attacker@example.com",
    textBody: "Hello customer\nYour charger was returned.",
    htmlBody: "<p>Hello customer</p>",
    date: new Date("2026-09-23T12:00:00Z"),
    boundary: "test-boundary",
  });

  assert.match(message, /From: Chargerent Customer Support <support@charge\.rent>/);
  assert.match(message, /To: customer@example\.com/);
  assert.match(message, /Subject: Refund update Bcc: attacker@example\.com/);
  assert.doesNotMatch(message, /\r\nBcc:/);
  assert.match(message, /Content-Type: multipart\/alternative/);
  assert.match(message, new RegExp(Buffer.from("Hello customer\nYour charger was returned.").toString("base64")));
});

test("sendMessage signs a delegated gmail.send token and sends raw MIME", async () => {
  const calls = [];
  let now = Date.parse("2026-09-23T12:00:00Z");
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (url.includes(":signJwt")) return response(200, {signedJwt: "signed-jwt"});
    if (url === "https://oauth2.googleapis.com/token") {
      return response(200, {access_token: "gmail-token", expires_in: 3600});
    }
    if (url.includes("gmail.googleapis.com")) return response(200, {id: "gmail-message-1", threadId: "thread-1"});
    throw new Error(`Unexpected URL ${url}`);
  };
  const sender = createGmailApiSender({admin: fakeAdmin(), fetchImpl, clock: () => now});

  const result = await sender.sendMessage({
    fromName: "Chargerent Customer Support",
    fromEmail: "support@charge.rent",
    replyTo: "support@charge.rent",
    to: "customer@example.com",
    subject: "Return instructions",
    textBody: "Please return the charger.",
    htmlBody: "<p>Please return the charger.</p>",
    gmailThreadId: "thread-existing",
    inReplyTo: "<customer-message@example.com>",
    references: "<first-message@example.com> <customer-message@example.com>",
    ticketId: "CS-ABC123",
  });

  assert.deepEqual(result, {messageId: "gmail-message-1", threadId: "thread-1"});
  assert.equal(calls.length, 3);
  const signRequest = JSON.parse(calls[0].options.body);
  const claims = JSON.parse(signRequest.payload);
  assert.equal(claims.iss, "chargerent-dashboard-mailer@node-red-alerts.iam.gserviceaccount.com");
  assert.equal(claims.sub, "support@charge.rent");
  assert.equal(claims.scope, GMAIL_SEND_SCOPE);

  const sendRequest = JSON.parse(calls[2].options.body);
  assert.equal(sendRequest.threadId, "thread-existing");
  const paddedRaw = sendRequest.raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((sendRequest.raw.length + 3) % 4);
  const mime = Buffer.from(paddedRaw, "base64").toString("utf8");
  assert.match(mime, /From: Chargerent Customer Support <support@charge\.rent>/);
  assert.match(mime, /Subject: Return instructions/);
  assert.match(mime, /In-Reply-To: <customer-message@example\.com>/);
  assert.match(mime, /References: <first-message@example\.com> <customer-message@example\.com>/);
  assert.match(mime, /X-Chargerent-Ticket: CS-ABC123/);

  now += 1000;
  await sender.sendMessage({
    fromName: "Chargerent Customer Support",
    fromEmail: "support@charge.rent",
    to: "second@example.com",
    subject: "Second message",
    textBody: "Another reply.",
    htmlBody: "<p>Another reply.</p>",
  });
  assert.equal(calls.filter((call) => call.url.includes(":signJwt")).length, 1);
});

test("sender token cache is isolated per impersonated mailbox", async () => {
  const claims = [];
  const fetchImpl = async (url, options) => {
    if (url.includes(":signJwt")) {
      claims.push(JSON.parse(JSON.parse(options.body).payload));
      return response(200, {signedJwt: `jwt-${claims.length}`});
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return response(200, {access_token: `token-${claims.length}`, expires_in: 3600});
    }
    return response(200, {id: `message-${claims.length}`});
  };
  const sender = createGmailApiSender({admin: fakeAdmin(), fetchImpl});
  const base = {to: "customer@example.com", subject: "Hello", textBody: "Body", htmlBody: "<p>Body</p>"};

  await sender.sendMessage({...base, fromEmail: "support@charge.rent"});
  await sender.sendMessage({...base, fromEmail: "george@charge.rent"});

  assert.deepEqual(claims.map((claim) => claim.sub), ["support@charge.rent", "george@charge.rent"]);
});

test("authorization failures are sanitized", async () => {
  const sender = createGmailApiSender({
    admin: fakeAdmin(),
    fetchImpl: async () => response(403, {error: {message: "sensitive provider response"}}),
  });

  await assert.rejects(
      sender.sendMessage({
        fromEmail: "support@charge.rent",
        to: "customer@example.com",
        subject: "Hello",
        textBody: "Body",
      }),
      (error) => error.code === "failed-precondition" && !error.message.includes("sensitive"),
  );
});
