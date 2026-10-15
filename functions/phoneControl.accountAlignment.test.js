/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  provisionTerminalConfigForKiosk,
  terminalCommandArguments,
  terminalConfigForKiosk,
} = require("./phoneControl");

function frKioskWithCachedLocation() {
  const kioskData = {
    info: {
      address: "1 Rue de Rivoli",
      city: "Paris",
      zip: "75001",
      country: "FR",
      location: "Account alignment fixture",
    },
    hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
    pricing: {
      text: "LEASE - SIMPLE DAILY",
      currency: "FR",
      kioskmode: "LEASE",
      initialperiod: 24,
      authamount: 30,
      dailyprice: 0,
      buyprice: 30,
      overdue: 24,
      rate: [{time: 1440, price: 0}],
    },
    modules: [{moduleid: "fr-v2-fixture", slots: [{position: 1}, {position: 2}]}],
  };
  const kiosk = {id: "id-fr-alignment-fixture", data: () => kioskData};
  const options = {stripeMode: "live", packageName: "com.chargerent.media.lab"};
  const config = terminalConfigForKiosk("FR8012", kiosk, options);
  kioskData.paymentTerminal = {
    stripeLocations: {
      live_FR: {
        locationId: "tml_previous_account",
        addressHash: config.stripeLocationAddressHash,
        accountCountry: "FR",
        stripeMode: "live",
      },
    },
  };
  return {kiosk, options};
}

test("reprovisions a cached Terminal location absent from the selected French billing account", async () => {
  const {kiosk, options} = frKioskWithCachedLocation();
  const calls = [];
  const stripe = {
    accounts: {retrieve: async () => ({
      id: "acct_existing_billing_fixture", country: "FR",
      details_submitted: true, charges_enabled: true,
    })},
    terminal: {locations: {
      retrieve: async (id) => {
        calls.push({operation: "retrieve", id});
        const error = new Error("No such location in the selected account.");
        error.statusCode = 404;
        throw error;
      },
      create: async (body, requestOptions) => {
        calls.push({operation: "create", body, requestOptions});
        return {id: "tml_existing_billing_account"};
      },
    }},
  };
  const config = await provisionTerminalConfigForKiosk("FR8012", kiosk, {
    ...options,
    getStripeClient: (selection) => {
      assert.deepEqual(selection, {accountCountry: "FR", mode: "live"});
      return stripe;
    },
  });
  assert.deepEqual(calls.map((call) => call.operation), ["retrieve", "create"]);
  assert.equal(calls[0].id, "tml_previous_account");
  assert.equal(calls[1].body.address.country, "FR");
  assert.equal(calls[1].body.metadata.chargerent_station_id, "FR8012");
  assert.match(calls[1].requestOptions.idempotencyKey, /^chargerent-terminal-location-live-FR-/);
  assert.equal(config.stripeLocationId, "tml_existing_billing_account");
  assert.equal(config.amountCents, 3000);
  assert.equal(config.currency, "eur");
  const command = terminalCommandArguments(config, {algorithm: "fixture"});
  assert.equal(command.restrictions.stripe_location_id, "tml_existing_billing_account");
  assert.equal(command.restrictions.stripe_mode, "live");
  assert.equal(command.restrictions.station_id, "FR8012");
});

test("a cached location permission failure stops reprovisioning without creating another location", async () => {
  const {kiosk, options} = frKioskWithCachedLocation();
  let created = 0;
  const permissionError = new Error("Location permission denied.");
  permissionError.statusCode = 403;
  await assert.rejects(provisionTerminalConfigForKiosk("FR8012", kiosk, {
    ...options,
    getStripeClient: () => ({
      accounts: {retrieve: async () => ({
        country: "FR", details_submitted: true, charges_enabled: true,
      })},
      terminal: {locations: {
        retrieve: async () => { throw permissionError; },
        create: async () => { created += 1; return {id: "tml_unexpected"}; },
      }},
    }),
  }), (error) => error === permissionError);
  assert.equal(created, 0);
});
