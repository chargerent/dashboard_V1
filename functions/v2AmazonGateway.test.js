/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const {createV2AmazonGateway, selectV2AmazonRoute} = require("./v2AmazonGateway");

const REQUEST = {
  stationid: "FR8012", moduleid: "100049231111490591", slotid: 2,
  chargerid: 41807101, transactionid: "pi_fixture", paymentMethodId: "pm_card_present_fixture",
  timerequested: Date.parse("2026-10-09T13:00:00Z"), powerlevel: 96, gatewayoptions: "FULLPRICE",
  pricing: {profile: "DEFAULT", kioskmode: "LEASE", authamount: 30, dailyprice: 0, buyprice: 30,
    taxrate: 0, overdue: 1, currency: "FR", rate: [{time: 1440, price: 0}]},
};

function transportFixture(results) {
  const calls = [];
  const gateway = createV2AmazonGateway({fetchImpl: async (url, options) => {
    calls.push({url, method: options.method, body: options.body ? JSON.parse(options.body) : null});
    const result = results[calls.length - 1];
    if (result instanceof Error) throw result;
    return {ok: result.ok !== false, json: async () => result.body};
  }});
  return {gateway, calls};
}

function assertOriginalPaymentAndSoleVend(calls) {
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://chargerent.online/stations/log-transaction");
  assert.equal(calls[1].body.transactionid, REQUEST.transactionid);
  assert.equal(calls[1].body.paymentmethod, REQUEST.paymentMethodId);
  assert.equal(Object.hasOwn(calls[1].body, "card_last4"), false);
  assert.equal(Object.hasOwn(calls[1].body, "card_type"), false);
  assert.equal(calls.filter(({url}) => url.endsWith("/stations/vend")).length, 1);
  assert.equal(calls[2].body.transactionid, REQUEST.transactionid);
  assert.deepEqual(Object.keys(calls[2].body).sort(), [
    "card_last4", "chargerid", "memberid", "moduleid", "powerlevel", "slot", "stationid",
    "time", "timereceived", "transactionid",
  ]);
}

test("normal V2 workflow initializes and registers the original authorization before its sole vend", async () => {
  const {gateway, calls} = transportFixture([{body: null}, {body: {success: true}},
    {body: {status: 1, stationid: "FR8012"}}]);
  assert.deepEqual(await gateway.sendVend(REQUEST), {accepted: true});
  assert.deepEqual(calls.map(({url, method}) => ({url, method})), [
    {url: "https://chargerent.online/stations/qr?id=FR8012", method: "GET"},
    {url: "https://chargerent.online/stations/log-transaction", method: "POST"},
    {url: "https://chargerent.online/stations/vend", method: "POST"},
  ]);
  assert.deepEqual(calls[1].body, {
    stationid: "FR8012", moduleid: REQUEST.moduleid, slot: 2, chargerid: 41807101,
    transactionid: "pi_fixture", rentaltime: REQUEST.timerequested / 1000,
    paymentmethod: "pm_card_present_fixture", authamount: 30, rentalprice: 0, buyprice: 30,
    taxrate: 0, overdue: 1, currency: "FR", kioskmode: "LEASE", gatewayoptions: "FULLPRICE",
    rentalrate: [{time: 1440, price: 0}], powerlevel: 96, formdata: {},
  });
  assert.equal(calls[2].body.transactionid, "pi_fixture");
  assert.equal(calls[2].body.slot, 2);
  assert.equal(calls[2].body.card_last4, "");
});

test("original Stripe last four are preserved when Amazon registration returns blank details", async () => {
  const {gateway, calls} = transportFixture([{body: null}, {body: {success: true, last4: "", brand: ""}},
    {body: {status: 1, stationid: "FR8012"}}]);
  assert.deepEqual(await gateway.sendVend({...REQUEST, card_last4: "0263", card_type: "mastercard"}),
      {accepted: true});
  assert.equal(calls[2].body.card_last4, "0263");
  assertOriginalPaymentAndSoleVend(calls);
});

test("original Stripe last four take precedence over different Amazon registration details", async () => {
  const {gateway, calls} = transportFixture([{body: null}, {body: {success: true, last4: "9999"}},
    {body: {status: 1, stationid: "FR8012"}}]);
  await gateway.sendVend({...REQUEST, card_last4: "6263", card_type: "mastercard"});
  assert.equal(calls[2].body.card_last4, "6263");
  assertOriginalPaymentAndSoleVend(calls);
});

test("a valid legacy registration last-four string remains available when the original details are absent", async () => {
  const {gateway, calls} = transportFixture([{body: null}, {body: {success: true, last4: "0007"}},
    {body: {status: 1, stationid: "FR8012"}}]);
  await gateway.sendVend(REQUEST);
  assert.equal(calls[2].body.card_last4, "0007");
  assertOriginalPaymentAndSoleVend(calls);
});

test("missing, malformed and non-string last-four details yield a blank existing vend field", async () => {
  const invalidValues = [undefined, null, "", "123", "12345", "4111111111111111", "12x4", " 1234",
    "1234 ", 1234, 0, false, ["1234"], {last4: "1234"}];
  for (const value of invalidValues) {
    for (const source of ["original", "registration"]) {
      const registration = {success: true, ...(source === "registration" ? {last4: value} : {})};
      const request = {...REQUEST, ...(source === "original" ? {card_last4: value} : {})};
      const {gateway, calls} = transportFixture([{body: null}, {body: registration},
        {body: {status: 1, stationid: "FR8012"}}]);
      await gateway.sendVend(request);
      assert.equal(calls[2].body.card_last4, "", `${source}: ${JSON.stringify(value)}`);
      assertOriginalPaymentAndSoleVend(calls);
    }
  }
});

test("registration failures and absent frozen pricing never reach the physical endpoint", async () => {
  for (const failure of [{ok: false}, {body: {success: false}}, new Error("registration timed out")]) {
    const {gateway, calls} = transportFixture([{body: null}, failure]);
    await assert.rejects(gateway.sendVend(REQUEST), (error) => error.phase === "registration" &&
      !error.mightHaveVended && error.ownershipMayHaveTransferred);
    assert.equal(calls.length, 2);
  }
  const {gateway, calls} = transportFixture([]);
  await assert.rejects(gateway.sendVend({...REQUEST, pricing: {...REQUEST.pricing, rate: []}}),
      (error) => !error.ownershipMayHaveTransferred);
  assert.equal(calls.length, 0);
});

test("timeout, bad response and another station remain uncertain and never retry a vend", async () => {
  for (const response of [new Error("timeout"), {ok: false}, {body: {status: 0}},
    {body: {status: 1, stationid: "FR8011"}}]) {
    const {gateway, calls} = transportFixture([{body: null}, {body: {success: true}}, response]);
    await assert.rejects(gateway.sendVend(REQUEST), (error) => error.mightHaveVended === true);
    assert.equal(calls.filter(({url}) => url.endsWith("/stations/vend")).length, 1);
  }
});

test("normal V2 billing requires an explicit matching Stripe mode, French station and verified payment profile", () => {
  const config = {enabled: true, stationIds: ["FR8012"], stripeMode: "live",
    stripeAccountId: "acct_existingBillingFixture", paymentProfile: "VERIFIED_FR_LIVE", paymentProfileVerified: true};
  const installation = {stationId: "FR8012", stripeMode: "live", stripeAccountCountry: "FR",
    moduleId: REQUEST.moduleid};
  assert.equal(selectV2AmazonRoute(config, installation).billingOwner, "amazon_v2");
  assert.throws(() => selectV2AmazonRoute({...config, enabled: false}, installation), /required-configuration-missing/);
  assert.equal(selectV2AmazonRoute(config, {...installation, stationId: "FR8011"}), null);
  for (const wrong of [{stripeMode: "test"}, {stripeAccountCountry: "CA"}, {moduleId: "LM-test"}]) {
    assert.throws(() => selectV2AmazonRoute(config, {...installation, ...wrong}));
  }
  assert.throws(() => selectV2AmazonRoute({...config, paymentProfile: ""}, installation));
  assert.throws(() => selectV2AmazonRoute({...config, paymentProfile: "DEFAULT"}, installation));
  assert.throws(() => selectV2AmazonRoute({...config, paymentProfileVerified: false}, installation));
  assert.throws(() => selectV2AmazonRoute({...config, paymentProfileVerified: undefined}, installation));
  assert.throws(() => selectV2AmazonRoute({...config, stripeMode: "test"}, {...installation, stripeMode: "test"}));
});
