/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  eligibleNotificationRecipients,
  hashedDocumentId,
  normalizeDestination,
  normalizeNotificationType,
  normalizePushToken,
} = require("./supportNotifications");

test("notification input is constrained to app destinations", () => {
  assert.equal(normalizeNotificationType("MISSED_CALL"), "missed_call");
  assert.equal(normalizeDestination("", "missed_call"), "missed_calls");
  assert.equal(normalizeDestination("messages", "text"), "messages");
  assert.throws(() => normalizeNotificationType("marketing"), /type is invalid/);
  assert.throws(() => normalizeDestination("browser", "case"), /destination is invalid/);
});

test("push tokens are validated without logging their contents", () => {
  const token = "valid-firebase-registration-token-123456";
  assert.equal(normalizePushToken(token), token);
  assert.throws(() => normalizePushToken("short"), /token is invalid/);
  assert.throws(() => normalizePushToken("invalid token with spaces"), /token is invalid/);
  assert.equal(hashedDocumentId("staff", token), hashedDocumentId("staff", token));
  assert.notEqual(hashedDocumentId("staff", token), hashedDocumentId("other", token));
});

test("notifications follow the staff support-number scope", () => {
  const staff = [
    {id: "admin", userUid: "admin-uid", enabled: true, allSupportNumbers: true},
    {id: "us", userUid: "us-uid", enabled: true, supportNumbers: ["+19179939355"]},
    {id: "fr", userUid: "fr-uid", enabled: true, supportNumbers: ["+33123456789"]},
    {id: "off", userUid: "off-uid", enabled: false, supportNumbers: ["+19179939355"]},
  ];
  assert.deepEqual(
      eligibleNotificationRecipients(staff, "+19179939355").map((member) => member.id),
      ["admin", "us"],
  );
  assert.deepEqual(
      eligibleNotificationRecipients(staff, "+33123456789").map((member) => member.id),
      ["admin", "fr"],
  );
  assert.deepEqual(
      eligibleNotificationRecipients(staff, "").map((member) => member.id),
      ["admin"],
  );
});
