/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GMAIL_READ_SCOPE,
  htmlToText,
  isWebsiteFormNotification,
  parseAddress,
  parseAddresses,
  parseGmailMessage,
  routeGmailMessage,
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
    recipientAddresses: ["support@charge.rent"],
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

test("newsletter and no-reply mail is marked for exclusion", () => {
  const newsletter = parseGmailMessage({
    id: "gmail-newsletter",
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "updates@example.com"},
        {name: "To", value: "sales@charge.rent"},
        {name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>"},
      ],
      body: {data: encoded("Monthly product newsletter")},
    },
  });
  const noReply = parseGmailMessage({
    id: "gmail-no-reply",
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "no-reply@example.com"},
        {name: "To", value: "sales@charge.rent"},
      ],
      body: {data: encoded("Account notification")},
    },
  });

  assert.equal(newsletter.automated, true);
  assert.equal(noReply.automated, true);
});

test("messages from Charge.rent users remain eligible for case import", () => {
  const parsed = parseGmailMessage({
    id: "gmail-company-reply",
    threadId: "thread-company-reply",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "Arthur <arthur@charge.rent>"},
        {name: "To", value: "support@charge.rent"},
        {name: "Subject", value: "Re: Test case [CS-CHAT63]"},
      ],
      body: {data: encoded("This internal test reply should reach the case.")},
    },
  });

  assert.equal(parsed.from, "arthur@charge.rent");
  assert.equal(parsed.automated, false);
  assert.equal(parsed.body, "This internal test reply should reach the case.");
});

test("sales-recipient messages are routed into the sales case category", () => {
  const parsed = parseGmailMessage({
    id: "gmail-sales-lead",
    threadId: "thread-sales-lead",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "Roza Prospect <roza@example.com>"},
        {name: "To", value: "Chargerent Sales <sales@charge.rent>, George <george@charge.rent>"},
        {name: "Delivered-To", value: "george@charge.rent"},
        {name: "Subject", value: "Event in Sunnyvale"},
      ],
      body: {data: encoded("We are hosting a summit and would like portable power banks.")},
    },
  }, "george@charge.rent");
  const routed = routeGmailMessage(parsed, {
    mailbox: "george@charge.rent",
    recipientFilter: "sales@charge.rent",
    defaultCategory: "sales",
  });

  assert.deepEqual(parseAddresses("Sales <sales@charge.rent>, George <george@charge.rent>"), [
    "sales@charge.rent",
    "george@charge.rent",
  ]);
  assert.deepEqual(parsed.recipientAddresses, ["sales@charge.rent", "george@charge.rent"]);
  assert.equal(routed.category, "sales");
  assert.equal(routed.inboundMailbox, "george@charge.rent");
  assert.equal(routed.originalRecipient, "sales@charge.rent");
});

test("Google Group sales deliveries use the external Reply-To sender", () => {
  const parsed = parseGmailMessage({
    id: "gmail-sales-group-lead",
    threadId: "thread-sales-group-lead",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "'Roza Amrollah' via Admin <admin@charge.rent>"},
        {name: "Reply-To", value: "Roza Amrollah <roza@pnptc.com>"},
        {name: "To", value: "sales@charge.rent"},
        {name: "List-ID", value: "<admin.charge.rent>"},
        {name: "Subject", value: "Event in Sunnyvale"},
      ],
      body: {data: encoded("We are hosting a summit and need portable power banks.")},
    },
  }, "george@charge.rent");

  assert.equal(parsed.from, "roza@pnptc.com");
  assert.equal(parsed.fromName, "Roza Amrollah");
  assert.equal(parsed.automated, false);
  assert.equal(routeGmailMessage(parsed, {
    mailbox: "george@charge.rent",
    recipientFilter: "sales@charge.rent",
    defaultCategory: "sales",
  }).category, "sales");
});

test("messages in George's inbox that were not sent to Sales are not routed", () => {
  const parsed = parseGmailMessage({
    id: "gmail-private",
    payload: {
      mimeType: "text/plain",
      headers: [
        {name: "From", value: "person@example.com"},
        {name: "To", value: "george@charge.rent"},
      ],
      body: {data: encoded("This message is not a sales-address inquiry.")},
    },
  }, "george@charge.rent");

  assert.equal(routeGmailMessage(parsed, {
    mailbox: "george@charge.rent",
    recipientFilter: "sales@charge.rent",
    defaultCategory: "sales",
  }), null);
});

test("legacy website form notifications are not duplicated as email cases", () => {
  assert.equal(isWebsiteFormNotification({
    subject: "Event request — Newhall — 2026-09-28",
    body: "Chargerent website request Q-example\nSubmitted: 2026-09-23T12:00:00.000Z",
  }), true);
  assert.equal(isWebsiteFormNotification({
    subject: "Event in Sunnyvale",
    body: "We are hosting a summit and have questions about portable power banks.",
  }), false);
});
