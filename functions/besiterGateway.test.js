/* eslint-env node */
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const test = require("node:test");

const {createMqttBesiterGateway, parseCredentials} = require("./besiterGateway");

function fakeConnector() {
  const calls = {connections: [], subscriptions: [], publishes: []};
  return {
    calls,
    connect(url, options) {
      calls.connections.push({url, options});
      const client = new EventEmitter();
      client.subscribe = (topic, subscribeOptions, callback) => {
        calls.subscriptions.push({topic, options: subscribeOptions});
        callback(null);
      };
      client.publish = (topic, rawPayload, publishOptions, callback) => {
        const payload = JSON.parse(rawPayload);
        calls.publishes.push({topic, payload, options: publishOptions});
        callback(null);
        if (payload.action === "status") {
          setImmediate(() => client.emit("message", `CSTA/post/${payload.stationid}`, Buffer.from(JSON.stringify({
            action: "status",
            stationid: payload.stationid,
            requestId: payload.requestId,
            status: [41807101],
            moduleid: "100049231111490591",
            vendbattery: {sn: 41807101, slot: 2, powerlevel: 97},
          }))));
        }
      };
      client.end = () => {};
      setImmediate(() => client.emit("connect"));
      return client;
    },
  };
}

test("parses one JSON secret containing the existing broker credentials", () => {
  assert.deepEqual(parseCredentials('{"username":"terminal","password":"private"}'), {
    username: "terminal",
    password: "private",
  });
  assert.throws(() => parseCredentials("not-json"), /valid JSON/);
});

test("requests correlated Besiter availability over the live CSTA contract", async () => {
  const connector = fakeConnector();
  const gateway = createMqttBesiterGateway({
    brokerUrl: "mqtt://broker.example:1883",
    credentials: {username: "terminal", password: "private"},
    connect: connector.connect,
  });

  const response = await gateway.requestAvailability({
    stationId: "CA8019",
    requestId: "availability-request-123",
    requestedAt: 1_787_000_000_000,
  });

  assert.equal(response.vendbattery.sn, 41807101);
  assert.deepEqual(connector.calls.subscriptions, [{
    topic: "CSTA/post/CA8019",
    options: {qos: 2},
  }]);
  assert.equal(connector.calls.publishes[0].topic, "CSTA/get");
  assert.equal(connector.calls.publishes[0].payload.action, "status");
  assert.equal(connector.calls.publishes[0].payload.requestId, "availability-request-123");
});

test("publishes the selected charger as a Besiter vend request", async () => {
  const connector = fakeConnector();
  const gateway = createMqttBesiterGateway({
    brokerUrl: "mqtt://broker.example:1883",
    credentials: {username: "terminal", password: "private"},
    connect: connector.connect,
  });

  await gateway.sendVend({
    stationid: "CA8019",
    moduleid: "100049231111490591",
    chargerid: 41807101,
    slotid: 2,
    requestId: "interaction-123456",
    paymentIntentId: "pi_test_8019",
    timerequested: 1_787_000_001_000,
  });

  const published = connector.calls.publishes[0];
  assert.equal(published.topic, "CSTA/get");
  assert.equal(published.options.qos, 2);
  assert.equal(published.payload.action, "vend");
  assert.equal(published.payload.chargerid, 41807101);
  assert.equal(published.payload.paymentIntentId, "pi_test_8019");
});
