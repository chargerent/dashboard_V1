/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {PDFDocument} = require("pdf-lib");
const {
  createChargeDropsAgreementService,
  maskEmail,
} = require("./chargeDropsAgreements");

const FIXED_NOW = new Date("2026-09-25T10:00:00.000Z");
const PROFILE = {
  username: "hudson",
  clientId: "HUDSON",
  role: "user",
  product: "chargedrops",
  portalBrand: "chargedrops",
  commission: "20",
  paymentSchedule: "monthly",
  contact: {
    name: "Alex Venue",
    email: "alex@example.com",
    phone: "480-555-0123",
  },
  chargedrops: {
    location: {
      venueName: "The Hudson Eatery & Bar",
      address: "1601 E Apache Blvd, Tempe, AZ 85281",
    },
    onboarding: {agreementStatus: "not_sent", payoutStatus: "not_started"},
  },
};

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function fakeDb() {
  const records = new Map([
    ["users/client-uid", clone(PROFILE)],
    ["users/admin-uid", {username: "chargerent", role: "admin"}],
  ]);
  let sequence = 0;

  function docRef(path, explicitId = "") {
    const id = explicitId || path.split("/").pop();
    return {
      id,
      path,
      async get() {
        const value = records.get(path);
        return {exists: value !== undefined, data: () => clone(value)};
      },
      async set(value, options) {
        const current = records.get(path) || {};
        records.set(path, clone(options?.merge ? {...current, ...value} : value));
      },
      async delete() {
        records.delete(path);
      },
      collection(name) {
        return collectionRef(`${path}/${name}`);
      },
    };
  }

  function collectionRef(path) {
    return {
      doc(id = "") {
        const resolvedId = id || `auto-${++sequence}`;
        return docRef(`${path}/${resolvedId}`, resolvedId);
      },
    };
  }

  return {
    records,
    collection: collectionRef,
  };
}

function fakeBucket() {
  const files = new Map();
  return {
    files,
    file(path) {
      return {
        async save(buffer, options) {
          if (options?.preconditionOpts?.ifGenerationMatch === 0 && files.has(path)) {
            throw new Error("file already exists");
          }
          files.set(path, Buffer.from(buffer));
        },
        async download() {
          if (!files.has(path)) throw new Error("file not found");
          return [Buffer.from(files.get(path))];
        },
        async getSignedUrl() {
          return [`https://storage.example/${encodeURIComponent(path)}`];
        },
      };
    },
  };
}

function setup() {
  const db = fakeDb();
  const bucket = fakeBucket();
  const emails = [];
  const notifications = [];
  const service = createChargeDropsAgreementService({
    db,
    bucket,
    admin: {
      firestore: {
        FieldValue: {serverTimestamp: () => new Date(FIXED_NOW)},
      },
    },
    getOtpSecret: () => "test-secret-that-is-at-least-thirty-two-characters",
    sendEmail: async (message) => emails.push(clone(message)),
    adminCopyEmail: () => "george@charge.rent",
    notifyPartner: async (notification) => {
      notifications.push(clone(notification));
      return {id: `notice-${notifications.length}`, status: "sent"};
    },
    now: () => new Date(FIXED_NOW),
    generateCode: () => "123456",
    logger: {error: () => {}},
  });
  return {bucket, db, emails, notifications, service};
}

async function prepare(service) {
  return service.prepareAgreement({
    authState: {uid: "admin-uid", isAdmin: true},
    uid: "client-uid",
    input: {
      legalBusinessName: "Hudson Hospitality LLC",
      effectiveDate: "2026-10-15",
      assetsDeployed: "One ChargeDrops kiosk with 12 powerbanks",
    },
  });
}

test("prepares an immutable agreement from the ChargeRent template", async () => {
  const {bucket, db, emails, notifications, service} = setup();
  const result = await prepare(service);

  assert.equal(result.agreement.status, "awaiting_signature");
  assert.match(result.agreement.title, /ChargeRent Revenue Share/);
  assert.equal(result.agreement.version, "V.11.01.2024");
  assert.match(result.agreement.agreementUrl, /^https:\/\/storage\.example\//);
  assert.equal(bucket.files.size, 1);
  const source = [...bucket.files.values()][0];
  assert.equal(source.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(
      db.records.get("users/client-uid").chargedrops.onboarding.agreementStatus,
      "awaiting_signature",
  );
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /ready to review/i);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventType, "agreement_ready");
});

test("client signs with portal authentication and emailed one-time code", async () => {
  const {bucket, db, emails, notifications, service} = setup();
  await prepare(service);
  const challenge = await service.requestCode({
    authState: {uid: "client-uid", isAdmin: false},
  });
  assert.equal(challenge.emailMasked, "al**@example.com");

  const result = await service.signAgreement({
    authState: {uid: "client-uid", isAdmin: false},
    input: {
      signerName: "Alex Venue",
      signerTitle: "Owner",
      code: "123456",
      reviewedDocument: true,
      consentElectronic: true,
      intentToSign: true,
    },
    evidence: {ipAddress: "203.0.113.4", userAgent: "Test Browser"},
  });

  assert.equal(result.agreement.status, "signed");
  assert.equal(result.agreement.signerName, "Alex Venue");
  assert.equal(bucket.files.size, 2);
  const signedPath = [...bucket.files.keys()].find((path) => path.endsWith("signed.pdf"));
  const signedPdf = await PDFDocument.load(bucket.files.get(signedPath));
  const sourcePath = [...bucket.files.keys()].find((path) => path.endsWith("source.pdf"));
  const sourcePdf = await PDFDocument.load(bucket.files.get(sourcePath));
  assert.equal(signedPdf.getPageCount(), sourcePdf.getPageCount() + 1);
  assert.equal(
      db.records.get("users/client-uid").chargedrops.onboarding.agreementStatus,
      "signed",
  );
  assert.equal(emails.length, 3);
  assert.match(emails[1].body, /123456/);
  assert.match(emails[2].subject, /client-signed ChargeDrops agreement/i);
  assert.equal(emails[2].attachments.length, 1);
  assert.deepEqual(
      notifications.map((notification) => notification.eventType),
      ["agreement_ready", "agreement_signed"],
  );
});

test("wrong verification codes are rejected without signing", async () => {
  const {db, service} = setup();
  await prepare(service);
  await service.requestCode({authState: {uid: "client-uid", isAdmin: false}});
  await assert.rejects(
      service.signAgreement({
        authState: {uid: "client-uid", isAdmin: false},
        input: {
          signerName: "Alex Venue",
          signerTitle: "Owner",
          code: "999999",
          reviewedDocument: true,
          consentElectronic: true,
          intentToSign: true,
        },
      }),
      (error) => error.code === "invalid-argument" && /invalid or expired/i.test(error.message),
  );
  assert.equal(db.records.get("chargeDropsAgreementChallenges/client-uid").attempts, 1);
  assert.equal(
      db.records.get("users/client-uid").chargedrops.onboarding.agreementStatus,
      "awaiting_signature",
  );
});

test("client cannot prepare or read another client's agreement", async () => {
  const {service} = setup();
  await assert.rejects(
      service.prepareAgreement({
        authState: {uid: "client-uid", isAdmin: false},
        uid: "client-uid",
        input: {},
      }),
      (error) => error.code === "permission-denied",
  );
  await assert.rejects(
      service.getStatus({
        authState: {uid: "client-uid", isAdmin: false},
        uid: "admin-uid",
      }),
      (error) => error.code === "permission-denied",
  );
});

test("masks agreement delivery addresses", () => {
  assert.equal(maskEmail("alex@example.com"), "al**@example.com");
  assert.equal(maskEmail("a@example.com"), "a**@example.com");
});
