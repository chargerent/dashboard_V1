/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createChargeDropsStripeConnect,
  summarizeAccount,
} = require("./chargeDropsStripeConnect");

const PROFILE = {
  username: "hudson",
  clientId: "HUDSON",
  role: "user",
  product: "chargedrops",
  portalBrand: "chargedrops",
  contact: {name: "Alex Venue", email: "alex@example.com"},
  chargedrops: {
    city: {id: "phoenix", displayName: "Phoenix", slug: "phoenix"},
    location: {
      venueName: "The Hudson",
      countryCode: "US",
      website: "https://example.com",
    },
    onboarding: {agreementStatus: "signed", payoutStatus: "not_started"},
  },
};

function fakeDb(profile = PROFILE) {
  const records = new Map([["users/client-uid", structuredClone(profile)]]);
  const writes = [];
  return {
    records,
    writes,
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            path,
            async get() {
              const value = records.get(path);
              return {
                exists: Boolean(value),
                data: () => structuredClone(value),
              };
            },
            async set(value, options) {
              const current = records.get(path) || {};
              const saved = options?.merge ? {...current, ...value} : value;
              records.set(path, structuredClone(saved));
              writes.push({path, value: structuredClone(value), options});
            },
            async update(value) {
              const current = records.get(path) || {};
              records.set(path, structuredClone({...current, ...value}));
              writes.push({path, value: structuredClone(value), update: true});
            },
          };
        },
      };
    },
  };
}

function fakeAdmin() {
  return {
    firestore: {
      FieldValue: {
        serverTimestamp: () => ({serverTimestamp: true}),
      },
    },
  };
}

function setup({profile = PROFILE, stripeOverrides = {}} = {}) {
  const db = fakeDb(profile);
  const calls = [];
  const notifications = [];
  const account = {
    id: "acct_chargeDrops123",
    object: "v2.core.account",
    livemode: false,
    applied_configurations: ["recipient"],
    identity: {country: "US"},
    defaults: {currency: "usd"},
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {status: "pending", status_details: []},
            payouts: {status: "pending", status_details: []},
          },
        },
      },
    },
    requirements: {entries: [{
      awaiting_action_from: "user",
      minimum_deadline: {status: "currently_due"},
      description: "Add an external payout account",
    }]},
    metadata: {
      chargerent_uid: "client-uid",
      chargerent_client_id: "HUDSON",
    },
  };
  const stripe = {
    v2: {
      core: {
        accounts: {
          async create(params, options) {
            calls.push({operation: "accounts.create", params, options});
            return structuredClone(account);
          },
          async retrieve(id, params) {
            calls.push({operation: "accounts.retrieve", id, params});
            return structuredClone(account);
          },
        },
        accountLinks: {
          async create(params) {
            calls.push({operation: "accountLinks.create", params});
            return {
              url: "https://connect.stripe.com/setup/c/test-link",
              expires_at: "2030-01-01T00:00:00.000Z",
            };
          },
        },
      },
    },
    ...stripeOverrides,
  };
  const service = createChargeDropsStripeConnect({
    db,
    admin: fakeAdmin(),
    getStripeClient: () => ({stripe, mode: "test"}),
    notifyPartner: async (notification) => {
      notifications.push(notification);
      return {id: `notice-${notifications.length}`, status: "sent"};
    },
    dashboardBaseUrl: "https://chargerentstations.com/portal/",
    logger: {error: () => {}},
  });
  return {db, calls, notifications, service, account};
}

test("account summary requires submitted details, payouts, and no requirements", () => {
  assert.deepEqual(summarizeAccount({
    id: "acct_ready123",
    object: "v2.core.account",
    applied_configurations: ["recipient"],
    identity: {country: "US"},
    defaults: {currency: "usd"},
    requirements: {entries: []},
    configuration: {recipient: {capabilities: {stripe_balance: {
      stripe_transfers: {status: "active"},
      payouts: {status: "active"},
    }}}},
  }, "live"), {
    provider: "stripe_connect",
    mode: "live",
    status: "complete",
    ready: true,
    detailsSubmitted: true,
    payoutsEnabled: true,
    requirementsDue: 0,
    country: "US",
    defaultCurrency: "usd",
    accountReference: "ady123",
  });
});

test("hosted onboarding creates an Express account without bank fields", async () => {
  const {db, calls, notifications, service} = setup();
  const result = await service.createOnboardingLink({
    authState: {uid: "client-uid", isAdmin: false},
  });

  assert.equal(result.url, "https://connect.stripe.com/setup/c/test-link");
  assert.equal(result.status, "requirements_due");
  const createCall = calls.find((call) => call.operation === "accounts.create");
  assert.equal(createCall.params.dashboard, "express");
  assert.equal(createCall.params.identity.country, "US");
  assert.deepEqual(createCall.params.configuration.recipient.capabilities, {
    stripe_balance: {stripe_transfers: {requested: true}},
  });
  assert.equal("external_account" in createCall.params, false);
  assert.equal(JSON.stringify(db.writes).includes("routing"), false);
  assert.equal(JSON.stringify(db.writes).includes("account_number"), false);

  const linkCall = calls.find((call) => call.operation === "accountLinks.create");
  assert.equal(linkCall.params.use_case.type, "account_onboarding");
  assert.equal(
      linkCall.params.use_case.account_onboarding.return_url,
      "https://chargerentstations.com/portal/?chargedropsPayout=return",
  );
  assert.equal(
      linkCall.params.use_case.account_onboarding.collection_options.fields,
      "eventually_due",
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventType, "payout_started");
});

test("Stripe account updates notify the partner on a status transition", async () => {
  const {service, account, notifications} = setup();
  const result = await service.syncAccountUpdate({
    ...account,
    livemode: false,
    requirements: {entries: []},
    configuration: {recipient: {capabilities: {stripe_balance: {
      stripe_transfers: {status: "active"},
      payouts: {status: "active"},
    }}}},
  });
  assert.equal(result.status, "complete");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventType, "payout_complete");
  assert.equal(notifications[0].actorUid, "stripe-webhook");
});

test("thin recipient events retrieve the full account before syncing", async () => {
  const {service, calls, notifications} = setup();
  const result = await service.syncEventNotification({
    type: "v2.core.account[requirements].updated",
    related_object: {id: "acct_chargeDrops123"},
  });

  assert.equal(result.status, "requirements_due");
  const retrieveCall = calls.find((call) =>
    call.operation === "accounts.retrieve");
  assert.equal(retrieveCall.id, "acct_chargeDrops123");
  assert.deepEqual(retrieveCall.params.include, [
    "configuration.recipient",
    "defaults",
    "future_requirements",
    "identity",
    "requirements",
  ]);
  assert.equal(notifications.length, 1);
});

test("returned onboarding links fetch the event account and sync it", async () => {
  const {service, calls} = setup();
  let fetched = false;
  const result = await service.syncEventNotification({
    type: "v2.core.account_link.returned",
    async fetchEvent() {
      fetched = true;
      return {
        data: {
          account_id: "acct_chargeDrops123",
          configurations: ["recipient"],
        },
      };
    },
  });

  assert.equal(fetched, true);
  assert.equal(result.status, "requirements_due");
  assert.equal(calls.some((call) =>
    call.operation === "accounts.retrieve"), true);
});

test("unrelated thin events are acknowledged without Stripe reads", async () => {
  const {service, calls} = setup();
  const result = await service.syncEventNotification({
    type: "v2.core.event_destination.ping",
  });
  assert.deepEqual(result, {ignored: true, reason: "ping"});
  assert.equal(calls.length, 0);
});

test("client cannot manage another profile", async () => {
  const {service} = setup();
  await assert.rejects(
      service.getStatus({
        authState: {uid: "client-uid", isAdmin: false},
        uid: "different-uid",
      }),
      (error) => error.code === "permission-denied",
  );
});

test("existing account metadata must match the dashboard client", async () => {
  const profile = structuredClone(PROFILE);
  profile.chargedrops.payout = {
    mode: "test",
    accounts: {test: "acct_chargeDrops123"},
  };
  const {service, account} = setup({
    profile,
    stripeOverrides: {
      v2: {
        core: {
          accounts: {
            async retrieve() {
              return {
                ...structuredClone(account),
                metadata: {
                  chargerent_uid: "someone-else",
                  chargerent_client_id: "HUDSON",
                },
              };
            },
          },
        },
      },
    },
  });
  await assert.rejects(
      service.getStatus({authState: {uid: "client-uid", isAdmin: false}}),
      (error) => error.code === "permission-denied",
  );
});

test("non-ChargeDrops profiles cannot start payout onboarding", async () => {
  const profile = {...structuredClone(PROFILE), product: "chargerent"};
  delete profile.portalBrand;
  const {service} = setup({profile});
  await assert.rejects(
      service.createOnboardingLink({
        authState: {uid: "client-uid", isAdmin: false},
      }),
      (error) => error.code === "failed-precondition",
  );
});

test("payout onboarding remains locked until the agreement is signed", async () => {
  const profile = structuredClone(PROFILE);
  profile.chargedrops.onboarding.agreementStatus = "awaiting_signature";
  const {service, calls} = setup({profile});
  await assert.rejects(
      service.createOnboardingLink({
        authState: {uid: "client-uid", isAdmin: false},
      }),
      (error) => error.code === "failed-precondition" &&
        /agreement/i.test(error.message),
  );
  assert.equal(calls.length, 0);
});
