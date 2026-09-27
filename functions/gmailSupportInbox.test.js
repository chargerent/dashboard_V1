/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GMAIL_READ_SCOPE,
  htmlToText,
  parseAddress,
  parseGmailMessage,
  trimQuotedReply,
} = require("./gmailSupportInbox");

function encoded(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

test("Gmail inbox access stays read-only", () => {
  assert.equal(GMAIL_READ_SCOPE, "https://www.googleapis.com/auth/gmail.readonly");
});

test("parseAddress separates a display name and email", () => {
  assert.deepEqual(parseAddress('"Taylor Customer" <Taylor@example.com>'), {
    name: "Taylor Customer",
    email: "taylor@example.com",
  });
  assert.deepEqual(parseAddress("person@example.com"), {
    name: "",
    email: "person@example.com",
  });
});

test("HTML email bodies are converted into readable text", () => {
  assert.equal(
      htmlToText("<style>.x{}</style><p>Hello &amp; thanks</p><div>Returned charger</div>"),
      "Hello & thanks\n Returned charger",
  );
});

test("quoted email history is excluded from the imported customer reply", () => {
  assert.equal(
      trimQuotedReply("The wallet number is 4321.\n\nOn Wed, Support wrote:\nPlease confirm."),
      "The wallet number is 4321.",
  );
});

test("Gmail messages are normalized for the support importer", () => {
  const message = parseGmailMessage({
    id: "gmail-1",
    threadId: "thread-1",
    internalDate: String(Date.parse("2026-09-23T12:00:00.000Z")),
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        {name: "From", value: "Taylor Customer <taylor@example.com>"},
        {name: "To", value: "support@charge.rent"},
        {name: "Subject", value: "Re: Return question [CS-ABC123]"},
        {name: "Message-ID", value: "<customer-message@example.com>"},
        {name: "In-Reply-To", value: "<support-message@charge.rent>"},
        {name: "References", value: "<support-message@charge.rent>"},
      ],
      parts: [{
        mimeType: "text/plain",
        body: {data: encoded("Yes, the charger was returned.\n\nOn Wed, Support wrote:\nCan you confirm?")},
      }],
    },
  });

  assert.deepEqual(message, {
    messageId: "gmail-1",
    threadId: "thread-1",
    rfcMessageId: "<customer-message@example.com>",
    inReplyTo: "<support-message@charge.rent>",
    references: "<support-message@charge.rent>",
    ticketId: "",
    from: "taylor@example.com",
    fromName: "Taylor Customer",
    to: "support@charge.rent",
    subject: "Re: Return question [CS-ABC123]",
    body: "Yes, the charger was returned.",
    receivedAt: "2026-09-23T12:00:00.000Z",
    automated: false,
    labelIds: ["INBOX", "UNREAD"],
  });
});

test("automated responses are marked for exclusion", () => {
  const parsed = parseGmailMessage({
    id: "gmail-auto",
    threadId: "thread-auto",
    labelIds: ["INBOX"],
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "no-reply@example.com"},
        {name: "To", value: "support@charge.rent"},
        {name: "Auto-Submitted", value: "auto-replied"},
      ],
      body: {data: encoded("Automatic response")},
    },
  });
  assert.equal(parsed.automated, true);
});
