/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildKioskAccessRecord,
  kioskAccessRecordsEqual,
  syncKioskAccessFromWrite,
} = require("./kioskAccessScope");

test("buildKioskAccessRecord normalizes the station and ownership identifiers", () => {
  assert.deepEqual(buildKioskAccessRecord("provision-1", {
    stationid: " us8004 ",
    info: {client: " client-one ", rep: " partner-one "},
  }), {
    stationId: "US8004",
    kioskDocId: "provision-1",
    clientId: "CLIENT-ONE",
    repId: "PARTNER-ONE",
  });
});

test("buildKioskAccessRecord falls back to the kiosk document id", () => {
  assert.equal(buildKioskAccessRecord("ca8019", {})?.stationId, "CA8019");
  assert.equal(buildKioskAccessRecord("invalid/id", {}), null);
});

test("kioskAccessRecordsEqual detects ownership changes", () => {
  const first = buildKioskAccessRecord("one", {
    stationid: "US8004",
    info: {client: "CLIENT-ONE", rep: "PARTNER-ONE"},
  });
  assert.equal(kioskAccessRecordsEqual(first, {...first}), true);
  assert.equal(kioskAccessRecordsEqual(first, {...first, clientId: "CLIENT-TWO"}), false);
});

test("syncKioskAccessFromWrite skips ordinary kiosk heartbeat updates", async () => {
  let collectionCalls = 0;
  const kiosk = {stationid: "US8004", info: {client: "CLIENT-ONE"}};
  const result = await syncKioskAccessFromWrite({
    before: kiosk,
    after: {...kiosk, lastseen: "later"},
    kioskDocId: "provision-1",
    db: {collection() { collectionCalls += 1; }},
    serverTimestamp: () => "timestamp",
  });

  assert.deepEqual(result, {changed: false, stationId: "US8004"});
  assert.equal(collectionCalls, 0);
});

test("syncKioskAccessFromWrite writes a new ownership projection", async () => {
  const writes = [];
  const db = {
    collection(name) {
      assert.equal(name, "kioskAccess");
      return {
        doc(id) {
          return {
            async set(data) {
              writes.push({id, data});
            },
          };
        },
      };
    },
  };

  const result = await syncKioskAccessFromWrite({
    before: null,
    after: {stationid: "US8004", info: {client: "CLIENT-ONE", rep: "PARTNER-ONE"}},
    kioskDocId: "provision-1",
    db,
    serverTimestamp: () => "timestamp",
  });

  assert.equal(result.changed, true);
  assert.deepEqual(writes, [{
    id: "US8004",
    data: {
      stationId: "US8004",
      kioskDocId: "provision-1",
      clientId: "CLIENT-ONE",
      repId: "PARTNER-ONE",
      updatedAt: "timestamp",
    },
  }]);
});

test("syncKioskAccessFromWrite safely removes an old station projection", async () => {
  const deleted = [];
  const db = {
    collection() {
      return {doc(id) { return {id}; }};
    },
    async runTransaction(callback) {
      await callback({
        async get(ref) {
          return {exists: true, data: () => ({kioskDocId: "provision-1"}), ref};
        },
        delete(ref) {
          deleted.push(ref.id);
        },
      });
    },
  };

  await syncKioskAccessFromWrite({
    before: {stationid: "US8004", info: {client: "CLIENT-ONE"}},
    after: null,
    kioskDocId: "provision-1",
    db,
    serverTimestamp: () => "timestamp",
  });

  assert.deepEqual(deleted, ["US8004"]);
});
