/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAccountingService,
  normalizeInvoiceDraft,
  summarizeCompany,
} = require("./accounting");

const fakeAdmin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => "server-time",
    },
  },
};

function snapshot(id, data) {
  return {
    id,
    exists: data != null,
    data: () => structuredClone(data || {}),
  };
}

function fakeQuery(docs) {
  return {
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    async get() {
      return {docs: docs.map(({id, data}) => snapshot(id, data))};
    },
  };
}

function fakeDb({company = null, bankConnections = [], invoices = [], reconciliations = []} = {}) {
  return {
    collection(name) {
      assert.equal(name, "accounting");
      return {
        doc(id) {
          assert.equal(id, "chargerent");
          return {
            async get() {
              return snapshot(id, company);
            },
            collection(collectionName) {
              const records = {
                bankConnections,
                invoices,
                reconciliations,
              }[collectionName];
              assert.ok(records, `Unexpected collection ${collectionName}`);
              return fakeQuery(records);
            },
          };
        },
      };
    },
  };
}

test("empty accounting workspace returns a safe unconfigured overview", async () => {
  const service = createAccountingService({db: fakeDb(), admin: fakeAdmin});
  const overview = await service.getOverview();

  assert.equal(overview.company.configured, false);
  assert.equal(overview.company.legalName, "Ocharge LLC");
  assert.equal(overview.company.baseCurrency, "USD");
  assert.equal(overview.company.nextInvoiceNumber, 1000);
  assert.equal(overview.capabilities.bankFeedReadOnly, true);
  assert.equal(overview.capabilities.plaidStatus, "not_configured");
  assert.deepEqual(overview.bankConnections, []);
  assert.deepEqual(overview.recentInvoices, []);
  assert.equal(overview.latestReconciliation, null);
});

test("overview exposes bank metadata without provider credentials", async () => {
  const service = createAccountingService({
    admin: fakeAdmin,
    db: fakeDb({
      company: {
        configured: true,
        legalName: "Ocharge LLC",
        baseCurrency: "usd",
        integrations: {plaid: {status: "ready"}},
        summary: {openInvoiceCount: 2, openInvoiceCents: 12500},
      },
      bankConnections: [{
        id: "chase",
        data: {
          provider: "plaid",
          institutionName: "Chase",
          status: "connected",
          accountCount: 2,
          accessToken: "must-not-leak",
        },
      }],
    }),
  });
  const overview = await service.getOverview();

  assert.equal(overview.company.legalName, "Ocharge LLC");
  assert.equal(overview.company.openInvoiceCents, 12500);
  assert.equal(overview.bankConnections[0].institutionName, "Chase");
  assert.equal("accessToken" in overview.bankConnections[0], false);
  assert.equal(JSON.stringify(overview).includes("must-not-leak"), false);
});

test("company summary rejects invalid counters and currency", () => {
  assert.deepEqual(summarizeCompany({
    baseCurrency: "dollars",
    summary: {
      openInvoiceCount: -1,
      unreviewedTransactionCount: "not-a-number",
      lastReconciledBalanceCents: -125,
    },
  }), {
    configured: false,
    legalName: "Ocharge LLC",
    baseCurrency: "USD",
    timezone: "America/Phoenix",
    nextInvoiceNumber: 1000,
    openInvoiceCount: 0,
    overdueInvoiceCount: 0,
    openInvoiceCents: 0,
    unreviewedTransactionCount: 0,
    lastReconciledBalanceCents: -125,
    lastReconciledThrough: null,
  });
});

test("sales tax can be enabled per invoice and is calculated in integer cents", () => {
  const invoice = normalizeInvoiceDraft({
    customerName: "Example Customer",
    customerEmail: "BILLING@example.com",
    issueDate: "2026-09-27",
    dueDate: "2026-10-27",
    currency: "usd",
    taxEnabled: true,
    taxRateBps: 825,
    lineItems: [
      {description: "Monthly service", quantityMillis: 1000, unitPriceCents: 10000},
      {description: "Additional units", quantityMillis: 2500, unitPriceCents: 2000},
    ],
  });

  assert.equal(invoice.customerEmail, "billing@example.com");
  assert.equal(invoice.subtotalCents, 15000);
  assert.equal(invoice.taxRateBps, 825);
  assert.equal(invoice.taxCents, 1238);
  assert.equal(invoice.totalCents, 16238);
  assert.equal(invoice.balanceDueCents, 16238);
});

test("sales tax toggle off forces a zero rate and zero tax", () => {
  const invoice = normalizeInvoiceDraft({
    customerName: "Tax-exempt Customer",
    issueDate: "2026-09-27",
    dueDate: "2026-09-27",
    taxEnabled: false,
    taxRateBps: 9999,
    lineItems: [{description: "Service", quantityMillis: 1000, unitPriceCents: 10000}],
  });

  assert.equal(invoice.taxEnabled, false);
  assert.equal(invoice.taxRateBps, 0);
  assert.equal(invoice.taxCents, 0);
  assert.equal(invoice.totalCents, 10000);
});

test("tax-enabled invoices require a sensible rate", () => {
  assert.throws(() => normalizeInvoiceDraft({
    customerName: "Example Customer",
    issueDate: "2026-09-27",
    dueDate: "2026-10-27",
    taxEnabled: true,
    taxRateBps: 0,
    lineItems: [{description: "Service", quantityMillis: 1000, unitPriceCents: 10000}],
  }), /Sales tax rate/);
});
