/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {PDFDocument} = require("pdf-lib");
const {
  createRegionalPartnerOnboarding,
  tokenHash,
} = require("./regionalPartnerOnboarding");

const FIXED_NOW = new Date("2026-10-06T12:00:00.000Z");
const RAW_TOKEN = "a".repeat(64);
const OTP_CODE = "654321";

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" &&
    !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value);
}

function mergeObjects(base, update) {
  const result = isPlainObject(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(update || {})) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ?
      mergeObjects(result[key], value) : clone(value);
  }
  return result;
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  while (parts.length > 1) {
    const part = parts.shift();
    cursor[part] = isPlainObject(cursor[part]) ? cursor[part] : {};
    cursor = cursor[part];
  }
  cursor[parts[0]] = clone(value);
}

function fakeDb() {
  const records = new Map();
  let sequence = 0;

  function directDocuments(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...records.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, value]) => ({
          id: path.slice(prefix.length),
          data: () => clone(value),
        }));
  }

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
        const current = records.get(path);
        records.set(path, options?.merge ?
          mergeObjects(current || {}, value) : clone(value));
      },
      async update(value) {
        const current = clone(records.get(path) || {});
        for (const [key, nextValue] of Object.entries(value || {})) {
          if (key.includes(".")) setPath(current, key, nextValue);
          else current[key] = clone(nextValue);
        }
        records.set(path, current);
      },
      async delete() {
        records.delete(path);
      },
    };
  }

  function collectionRef(path) {
    return {
      doc(id = "") {
        const resolvedId = id || `auto-${++sequence}`;
        return docRef(`${path}/${resolvedId}`, resolvedId);
      },
      async get() {
        const docs = directDocuments(path);
        return {docs, empty: docs.length === 0};
      },
      where(field, operator, expected) {
        assert.equal(operator, "==");
        let maximum = Infinity;
        const query = {
          limit(value) {
            maximum = value;
            return query;
          },
          async get() {
            const docs = directDocuments(path)
                .filter((doc) => doc.data()?.[field] === expected)
                .slice(0, maximum);
            return {docs, empty: docs.length === 0};
          },
        };
        return query;
      },
    };
  }

  return {
    records,
    collection: collectionRef,
    batch() {
      const writes = [];
      return {
        set(ref, value, options) {
          writes.push(() => ref.set(value, options));
        },
        async commit() {
          for (const write of writes) await write();
        },
      };
    },
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
  const authUsers = new Map();
  const claims = new Map();
  const admin = {
    firestore: {
      FieldValue: {serverTimestamp: () => new Date(FIXED_NOW)},
    },
    auth() {
      return {
        async createUser(input) {
          const uid = `partner-${authUsers.size + 1}`;
          authUsers.set(uid, {...clone(input), uid});
          return {uid};
        },
        async setCustomUserClaims(uid, value) {
          claims.set(uid, clone(value));
        },
        async deleteUser(uid) {
          authUsers.delete(uid);
        },
        async updateUser(uid, value) {
          authUsers.set(uid, {...(authUsers.get(uid) || {}), ...clone(value)});
        },
        async generatePasswordResetLink(email, options) {
          assert.equal(options.url, "https://chargerentstations.com/portal/");
          return `https://auth.example/reset?email=${encodeURIComponent(email)}`;
        },
      };
    },
  };
  const service = createRegionalPartnerOnboarding({
    db,
    admin,
    bucket,
    sendEmail: async (message) => emails.push(clone(message)),
    getOtpSecret: () => "test-secret-that-is-at-least-thirty-two-characters",
    now: () => new Date(FIXED_NOW),
    generateCode: () => OTP_CODE,
    generateToken: () => RAW_TOKEN,
    isAgreementApproved: () => false,
    logger: {error: () => {}},
  });
  return {authUsers, bucket, claims, db, emails, service};
}

async function runCompleteFlow(partnerType) {
  const state = setup();
  const {authUsers, bucket, claims, db, emails, service} = state;
  const suffix = partnerType === "individual" ? "IND" : "CO";
  const invite = await service.createInvite({
    authState: {uid: "admin-uid", isAdmin: true},
    input: {
      partnerType,
      contactName: "Alex Partner",
      contactEmail: "test.partner@example.ca",
      username: `alex.${partnerType}`,
      clientId: `AB-${suffix}`,
      province: "AB",
      territory: "Edmonton and Northern Alberta",
      testMode: true,
    },
  });

  assert.equal(invite.notificationStatus, "sent");
  assert.equal(invite.id, tokenHash(RAW_TOKEN));
  const inviteUrl = new URL(invite.inviteUrl);
  assert.equal(inviteUrl.origin, "https://chargerentstations.com");
  assert.equal(inviteUrl.pathname, "/portal/");
  assert.equal(inviteUrl.searchParams.get("partnerInvite"), RAW_TOKEN);
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /^\[TEST\]/);
  assert.match(emails[0].body, new RegExp(invite.inviteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(emails[0].body, /draft agreement/i);

  let status = await service.getStatus({token: RAW_TOKEN});
  assert.equal(status.status, "invited");
  assert.equal(status.partnerType, partnerType);
  assert.equal(status.contactEmailMasked, "te**********@example.ca");

  status = await service.submitProfile({
    token: RAW_TOKEN,
    input: {
      legalName: partnerType === "individual" ?
        "Alex Partner" : "Maple Venue Partners Inc.",
      businessAddress: "101 Jasper Avenue",
      city: "Edmonton",
      postalCode: "T5J 1N9",
      telephone: "+1 780-555-0100",
      taxNumber: partnerType === "individual" ? "" : "123456789RT0001",
      ...(partnerType === "company" ? {
        signerName: "Alex Partner",
        signerTitle: "President",
      } : {}),
    },
  });
  assert.equal(status.status, "awaiting_signature");
  assert.equal(status.agreement.status, "awaiting_signature");
  assert.match(status.agreement.agreementUrl, /^https:\/\/storage\.example\//);
  assert.equal(emails.length, 2);
  assert.match(emails[1].subject, /agreement is ready/i);

  await service.requestAgreementCode({token: RAW_TOKEN});
  assert.equal(emails.length, 3);
  assert.match(emails[2].body, new RegExp(OTP_CODE));

  status = await service.signAgreement({
    token: RAW_TOKEN,
    input: {
      signerName: "Alex Partner",
      ...(partnerType === "company" ? {signerTitle: "President"} : {}),
      code: OTP_CODE,
      reviewedDocument: true,
      consentElectronic: true,
      intentToSign: true,
    },
    evidence: {ipAddress: "203.0.113.10", userAgent: "Onboarding E2E Test"},
  });
  assert.equal(status.status, "ready_for_approval");
  assert.equal(status.agreement.status, "signed");
  assert.equal(emails.length, 4);
  assert.equal(emails[3].attachments.length, 1);
  const sourcePath = [...bucket.files.keys()].find((path) => path.endsWith("source.pdf"));
  const signedPath = [...bucket.files.keys()].find((path) => path.endsWith("signed.pdf"));
  const sourcePdf = await PDFDocument.load(bucket.files.get(sourcePath));
  const signedPdf = await PDFDocument.load(bucket.files.get(signedPath));
  assert.equal(sourcePdf.getPageCount(), 4);
  assert.equal(signedPdf.getPageCount(), 5);

  const activation = await service.activate({
    authState: {uid: "admin-uid", isAdmin: true},
    inviteId: invite.id,
  });
  assert.deepEqual(activation, {ok: true, status: "activated", emailStatus: "sent"});
  assert.equal(emails.length, 5);
  assert.match(emails[4].body, /Set your password securely/i);
  assert.match(emails[4].body, /https:\/\/auth\.example\/reset/);
  assert.equal(authUsers.get(invite.uid).disabled, false);
  assert.equal(claims.get(invite.uid).role, "partner");
  assert.equal(db.records.get(`users/${invite.uid}`).active, true);

  status = await service.getStatus({token: RAW_TOKEN});
  assert.equal(status.status, "activated");
  assert.equal(status.activation.status, "active");
  const listed = await service.listInvites({
    authState: {uid: "admin-uid", isAdmin: true},
  });
  assert.equal(listed.invitations.length, 1);
  assert.equal(listed.invitations[0].partnerType, partnerType);
  assert.equal(listed.invitations[0].activation.status, "active");
  return state;
}

test("company partner completes invitation through dashboard activation", async () => {
  await runCompleteFlow("company");
});

test("individual partner completes invitation through dashboard activation", async () => {
  await runCompleteFlow("individual");
});

test("production invitations remain locked until approval is configured", async () => {
  const {service} = setup();
  await assert.rejects(
      service.createInvite({
        authState: {uid: "admin-uid", isAdmin: true},
        input: {
          partnerType: "company",
          contactName: "Alex Partner",
          contactEmail: "test.partner@example.ca",
          username: "alex.production",
          clientId: "AB-PROD",
          province: "AB",
          territory: "Edmonton and Northern Alberta",
          testMode: false,
        },
      }),
      (error) => error.code === "failed-precondition" && /locked/i.test(error.message),
  );
});
