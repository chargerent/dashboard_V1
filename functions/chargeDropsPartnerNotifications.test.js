/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPartnerMessage,
  createChargeDropsPartnerNotifications,
  notificationId,
} = require("./chargeDropsPartnerNotifications");

const CLIENT = {
  clientId: "HUDSON",
  regionalPartnerUid: "partner-uid",
  regionalPartnerId: "PHOENIX",
  contact: {email: "client@example.com"},
  chargedrops: {
    city: {displayName: "Phoenix"},
    location: {venueName: "The Hudson Eatery & Bar"},
  },
};

const PARTNER = {
  clientId: "PHOENIX",
  role: "partner",
  active: true,
  username: "phoenix-partner",
  contact: {name: "Pat Partner", email: "partner@example.com"},
};

function mergeObjects(left, right) {
  const output = {...left};
  for (const [key, value] of Object.entries(right || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) &&
        output[key] && typeof output[key] === "object" &&
        !Array.isArray(output[key])) {
      output[key] = mergeObjects(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function fakeDb(seed = {}) {
  const records = new Map(Object.entries(seed));
  const snapshot = (id, value) => ({
    id,
    exists: value !== undefined,
    data: () => value,
  });
  const collection = (name) => ({
    doc(id) {
      const key = `${name}/${id}`;
      return {
        id,
        async get() {
          return snapshot(id, records.get(key));
        },
        async set(value, options = {}) {
          const next = options.merge ?
            mergeObjects(records.get(key) || {}, value) : value;
          records.set(key, next);
        },
      };
    },
    where(field, operator, expected) {
      assert.equal(operator, "==");
      return {
        limit() {
          return {
            async get() {
              const docs = [];
              for (const [key, value] of records.entries()) {
                if (!key.startsWith(`${name}/`)) continue;
                if (value?.[field] !== expected) continue;
                docs.push(snapshot(key.slice(name.length + 1), value));
              }
              return {docs};
            },
          };
        },
      };
    },
  });
  return {collection, records};
}

const admin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => "server-time",
    },
  },
};

test("builds a status-only regional-partner message", () => {
  const message = buildPartnerMessage({
    eventType: "agreement_signed",
    clientProfile: CLIENT,
    partnerProfile: PARTNER,
    dashboardBaseUrl: "https://chargerentstations.com/portal/",
  });
  assert.match(message.subject, /The Hudson.*Agreement signed/);
  assert.match(message.body, /Current stage: Agreement signed/);
  assert.doesNotMatch(message.body, /secret-password|routing number|acct_/i);
  assert.match(message.body, /standard Chargerent dashboard/);
});

test("sends once and records an idempotent audit entry", async () => {
  const db = fakeDb({"users/partner-uid": PARTNER});
  const messages = [];
  const service = createChargeDropsPartnerNotifications({
    db,
    admin,
    async sendEmail(message) {
      messages.push(message);
      return {
        accepted: [message.to],
        rejected: [],
        messageId: "message-1",
      };
    },
  });
  const input = {
    clientUid: "client-uid",
    clientProfile: CLIENT,
    eventType: "payout_complete",
    eventKey: "acct_test:complete",
    actorUid: "stripe-webhook",
  };
  const first = await service.notify(input);
  const second = await service.notify(input);
  assert.equal(first.status, "sent");
  assert.equal(second.status, "sent");
  assert.equal(second.duplicate, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "partner@example.com");
  const id = notificationId(
      "client-uid",
      "payout_complete",
      "acct_test:complete",
  );
  assert.equal(
      db.records.get(`chargeDropsPartnerNotifications/${id}`).status,
      "sent",
  );
});

test("skips safely when no partner email can be resolved", async () => {
  const db = fakeDb();
  const service = createChargeDropsPartnerNotifications({
    db,
    admin,
    async sendEmail() {
      throw new Error("should not send");
    },
  });
  const result = await service.notify({
    clientUid: "client-uid",
    clientProfile: {...CLIENT, regionalPartnerUid: "missing"},
    eventType: "onboarding_started",
    eventKey: "client-uid",
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "partner-email-unavailable");
});

test("skips partner email for an Ocharge LLC company-managed location", async () => {
  const db = fakeDb();
  let sends = 0;
  const service = createChargeDropsPartnerNotifications({
    db,
    admin,
    async sendEmail() {
      sends += 1;
    },
  });
  const input = {
    clientUid: "company-client-uid",
    clientProfile: {
      ...CLIENT,
      regionalPartnerUid: "",
      regionalPartnerId: "OCHARGELLC",
      regionalPartnerType: "company_managed",
    },
    eventType: "onboarding_started",
    eventKey: "company-client-uid",
  };
  const result = await service.notify(input);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "company-managed-location");
  assert.equal(sends, 0);
  assert.equal(
      db.records.get(`chargeDropsPartnerNotifications/${result.id}`).reason,
      "company-managed-location",
  );
});

test("retries only a definitely failed audited notification", async () => {
  const db = fakeDb({
    "users/partner-uid": PARTNER,
    "users/client-uid": CLIENT,
  });
  let shouldFail = true;
  let sends = 0;
  const service = createChargeDropsPartnerNotifications({
    db,
    admin,
    async sendEmail(message) {
      sends += 1;
      if (shouldFail) {
        const error = new Error("synthetic pre-send failure");
        error.notificationBeforeSend = true;
        throw error;
      }
      return {accepted: [message.to], rejected: [], messageId: "message-2"};
    },
    logger: {error() {}},
  });
  const input = {
    clientUid: "client-uid",
    clientProfile: CLIENT,
    eventType: "agreement_ready",
    eventKey: "agreement-1",
  };
  const failed = await service.notify(input);
  assert.equal(failed.status, "failed");

  shouldFail = false;
  const retried = await service.retry({notificationId: failed.id});
  const duplicate = await service.retry({notificationId: failed.id});
  assert.equal(retried.status, "sent");
  assert.equal(duplicate.status, "sent");
  assert.equal(duplicate.duplicate, true);
  assert.equal(sends, 2);
});
