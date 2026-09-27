/* eslint-env node */

const ACCOUNTING_COLLECTION = "accounting";
const DEFAULT_COMPANY_ID = "chargerent";
const DEFAULT_COMPANY = Object.freeze({
  legalName: "Ocharge LLC",
  baseCurrency: "USD",
  timezone: "America/Phoenix",
  startingInvoiceNumber: 1000,
});
const MAX_LINE_ITEMS = 50;
const MAX_UNIT_PRICE_CENTS = 100000000;
const MAX_TAX_RATE_BPS = 2500;

function validationError(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  error.safe = true;
  return error;
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeCurrency(value) {
  const currency = String(value || "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function normalizeInvoiceDate(value, fieldName) {
  const date = String(value || "").trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw validationError(`${fieldName} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw validationError(`${fieldName} is not a valid date.`);
  }
  return date;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validationError("Customer email is invalid.");
  }
  return email;
}

function normalizeInvoiceDraft(data = {}) {
  const customerName = String(data.customerName || "").trim();
  if (!customerName || customerName.length > 160) {
    throw validationError("Customer name is required and must be 160 characters or fewer.");
  }

  const issueDate = normalizeInvoiceDate(data.issueDate, "Issue date");
  const dueDate = normalizeInvoiceDate(data.dueDate, "Due date");
  if (dueDate < issueDate) throw validationError("Due date cannot be before the issue date.");

  if (!Array.isArray(data.lineItems) || data.lineItems.length < 1 || data.lineItems.length > MAX_LINE_ITEMS) {
    throw validationError(`An invoice needs between 1 and ${MAX_LINE_ITEMS} line items.`);
  }

  const lineItems = data.lineItems.map((item, index) => {
    const description = String(item?.description || "").trim();
    const quantityMillis = Number(item?.quantityMillis);
    const unitPriceCents = Number(item?.unitPriceCents);
    if (!description || description.length > 240) {
      throw validationError(`Line ${index + 1} needs a description of 240 characters or fewer.`);
    }
    if (!Number.isSafeInteger(quantityMillis) || quantityMillis <= 0 || quantityMillis > 1000000) {
      throw validationError(`Line ${index + 1} has an invalid quantity.`);
    }
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > MAX_UNIT_PRICE_CENTS) {
      throw validationError(`Line ${index + 1} has an invalid unit price.`);
    }
    const lineTotalCents = Math.round((quantityMillis * unitPriceCents) / 1000);
    if (!Number.isSafeInteger(lineTotalCents)) throw validationError(`Line ${index + 1} total is too large.`);
    return {description, quantityMillis, unitPriceCents, lineTotalCents};
  });

  const subtotalCents = lineItems.reduce((total, item) => total + item.lineTotalCents, 0);
  if (!Number.isSafeInteger(subtotalCents)) throw validationError("Invoice subtotal is too large.");

  const taxEnabled = data.taxEnabled === true;
  const taxRateBps = taxEnabled ? Number(data.taxRateBps) : 0;
  if (taxEnabled && (!Number.isSafeInteger(taxRateBps) || taxRateBps <= 0 || taxRateBps > MAX_TAX_RATE_BPS)) {
    throw validationError("Sales tax rate must be greater than 0% and no more than 25%.");
  }
  const taxCents = taxEnabled ? Math.round((subtotalCents * taxRateBps) / 10000) : 0;
  const totalCents = subtotalCents + taxCents;

  return {
    customerName,
    customerEmail: normalizeEmail(data.customerEmail),
    issueDate,
    dueDate,
    currency: normalizeCurrency(data.currency || DEFAULT_COMPANY.baseCurrency),
    lineItems,
    subtotalCents,
    taxEnabled,
    taxRateBps,
    taxCents,
    totalCents,
    balanceDueCents: totalCents,
  };
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw validationError("A valid invoice request ID is required.");
  }
  return requestId;
}

function summarizeCompany(company = {}) {
  const summary = company.summary || {};
  return {
    configured: company.configured === true,
    legalName: String(company.legalName || DEFAULT_COMPANY.legalName).trim(),
    baseCurrency: normalizeCurrency(company.baseCurrency || DEFAULT_COMPANY.baseCurrency),
    timezone: String(company.timezone || DEFAULT_COMPANY.timezone).trim(),
    nextInvoiceNumber: Number.isSafeInteger(Number(company.nextInvoiceNumber)) && Number(company.nextInvoiceNumber) >= DEFAULT_COMPANY.startingInvoiceNumber ?
      Number(company.nextInvoiceNumber) : DEFAULT_COMPANY.startingInvoiceNumber,
    openInvoiceCount: nonNegativeInteger(summary.openInvoiceCount),
    overdueInvoiceCount: nonNegativeInteger(summary.overdueInvoiceCount),
    openInvoiceCents: nonNegativeInteger(summary.openInvoiceCents),
    unreviewedTransactionCount: nonNegativeInteger(summary.unreviewedTransactionCount),
    lastReconciledBalanceCents: Number.isSafeInteger(Number(summary.lastReconciledBalanceCents)) ?
      Number(summary.lastReconciledBalanceCents) : 0,
    lastReconciledThrough: serializeTimestamp(summary.lastReconciledThrough),
  };
}

function serializeBankConnection(docSnap) {
  const connection = docSnap.data() || {};
  return {
    id: docSnap.id,
    provider: String(connection.provider || "").trim(),
    institutionName: String(connection.institutionName || "").trim(),
    status: String(connection.status || "disconnected").trim(),
    accountCount: nonNegativeInteger(connection.accountCount),
    lastSyncedAt: serializeTimestamp(connection.lastSyncedAt),
    consentExpiresAt: serializeTimestamp(connection.consentExpiresAt),
  };
}

function serializeInvoice(docSnap) {
  const invoice = docSnap.data() || {};
  return {
    id: docSnap.id,
    invoiceNumber: String(invoice.invoiceNumber || "").trim(),
    customerName: String(invoice.customerName || "").trim(),
    status: String(invoice.status || "draft").trim(),
    currency: normalizeCurrency(invoice.currency),
    totalCents: nonNegativeInteger(invoice.totalCents),
    balanceDueCents: nonNegativeInteger(invoice.balanceDueCents),
    subtotalCents: nonNegativeInteger(invoice.subtotalCents),
    taxEnabled: invoice.taxEnabled === true,
    taxRateBps: invoice.taxEnabled === true ? nonNegativeInteger(invoice.taxRateBps) : 0,
    taxCents: invoice.taxEnabled === true ? nonNegativeInteger(invoice.taxCents) : 0,
    issueDate: serializeTimestamp(invoice.issueDate),
    dueDate: serializeTimestamp(invoice.dueDate),
  };
}

function serializeReconciliation(docSnap) {
  if (!docSnap) return null;
  const reconciliation = docSnap.data() || {};
  return {
    id: docSnap.id,
    status: String(reconciliation.status || "draft").trim(),
    statementEndDate: serializeTimestamp(reconciliation.statementEndDate),
    statementEndingBalanceCents: Number.isSafeInteger(Number(reconciliation.statementEndingBalanceCents)) ?
      Number(reconciliation.statementEndingBalanceCents) : 0,
    differenceCents: Number.isSafeInteger(Number(reconciliation.differenceCents)) ?
      Number(reconciliation.differenceCents) : 0,
    completedAt: serializeTimestamp(reconciliation.completedAt),
  };
}

function createAccountingService({db, admin, companyId = DEFAULT_COMPANY_ID}) {
  if (!db) throw new Error("Accounting requires Firestore.");
  if (!admin?.firestore?.FieldValue?.serverTimestamp) throw new Error("Accounting requires Firebase Admin.");

  async function getOverview() {
    const companyRef = db.collection(ACCOUNTING_COLLECTION).doc(companyId);
    const [companySnap, bankConnectionsSnap, invoicesSnap, reconciliationsSnap] = await Promise.all([
      companyRef.get(),
      companyRef.collection("bankConnections").limit(10).get(),
      companyRef.collection("invoices").orderBy("createdAt", "desc").limit(5).get(),
      companyRef.collection("reconciliations").orderBy("statementEndDate", "desc").limit(1).get(),
    ]);

    const company = companySnap.exists ? companySnap.data() || {} : {};
    return {
      company: summarizeCompany(company),
      bankConnections: bankConnectionsSnap.docs.map(serializeBankConnection),
      recentInvoices: invoicesSnap.docs.map(serializeInvoice),
      latestReconciliation: serializeReconciliation(reconciliationsSnap.docs[0]),
      capabilities: {
        invoicing: true,
        manualBankImport: true,
        bankFeedReadOnly: true,
        plaidStatus: String(company.integrations?.plaid?.status || "not_configured"),
      },
    };
  }

  async function createDraftInvoice(data = {}, authState = {}) {
    if (!authState.uid) throw new Error("Administrator identity is required.");
    const requestId = normalizeRequestId(data.requestId);
    const draft = normalizeInvoiceDraft(data);
    const companyRef = db.collection(ACCOUNTING_COLLECTION).doc(companyId);
    const requestRef = companyRef.collection("invoiceRequests").doc(requestId);
    const invoiceRef = companyRef.collection("invoices").doc();
    const auditRef = companyRef.collection("auditEvents").doc();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const transactionResult = await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) {
        const existing = requestSnap.data() || {};
        return {invoiceId: String(existing.invoiceId || ""), duplicate: true};
      }

      const companySnap = await transaction.get(companyRef);
      const company = companySnap.exists ? companySnap.data() || {} : {};
      const sequence = Number.isSafeInteger(Number(company.nextInvoiceNumber)) && Number(company.nextInvoiceNumber) >= DEFAULT_COMPANY.startingInvoiceNumber ?
        Number(company.nextInvoiceNumber) : DEFAULT_COMPANY.startingInvoiceNumber;
      const invoiceNumber = String(sequence);
      const invoice = {
        ...draft,
        invoiceNumber,
        invoiceSequence: sequence,
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
        createdByUid: authState.uid,
        createdByUsername: String(authState.profile?.username || "").trim().toLowerCase(),
      };

      transaction.set(invoiceRef, invoice);
      transaction.set(companyRef, {
        configured: true,
        legalName: DEFAULT_COMPANY.legalName,
        baseCurrency: DEFAULT_COMPANY.baseCurrency,
        timezone: DEFAULT_COMPANY.timezone,
        nextInvoiceNumber: sequence + 1,
        invoiceTaxMode: "per_invoice",
        updatedAt: timestamp,
        createdAt: company.createdAt || timestamp,
      }, {merge: true});
      transaction.set(requestRef, {
        invoiceId: invoiceRef.id,
        invoiceNumber,
        createdAt: timestamp,
        createdByUid: authState.uid,
      });
      transaction.set(auditRef, {
        action: "invoice.created",
        entityType: "invoice",
        entityId: invoiceRef.id,
        invoiceNumber,
        actorUid: authState.uid,
        actorUsername: String(authState.profile?.username || "").trim().toLowerCase(),
        createdAt: timestamp,
      });
      return {invoiceId: invoiceRef.id, duplicate: false};
    });

    if (!transactionResult.invoiceId) throw new Error("Invoice request could not be resolved.");
    const savedInvoice = await companyRef.collection("invoices").doc(transactionResult.invoiceId).get();
    if (!savedInvoice.exists) throw new Error("Invoice was not found after creation.");
    return {
      ok: true,
      duplicate: transactionResult.duplicate,
      invoice: serializeInvoice(savedInvoice),
    };
  }

  return {createDraftInvoice, getOverview};
}

module.exports = {
  ACCOUNTING_COLLECTION,
  DEFAULT_COMPANY,
  DEFAULT_COMPANY_ID,
  createAccountingService,
  normalizeInvoiceDraft,
  normalizeCurrency,
  serializeBankConnection,
  serializeInvoice,
  summarizeCompany,
};
