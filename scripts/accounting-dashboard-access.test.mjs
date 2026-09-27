import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Accounting navigation and the direct route are admin-only', async () => {
  const [app, adminPage] = await Promise.all([
    readSource('../src/App.jsx'),
    readSource('../src/pages/AdminPage.jsx'),
  ]);

  assert.match(app, /const hasAccountingAccess = clientInfo\.isAdmin === true;/);
  assert.match(app, /case 'accounting':\s+if \(!hasAccountingAccess\)/);
  assert.match(app, /onNavigateToAccounting=\{\(\) => setPage\('accounting'\)\}/);
  assert.match(adminPage, /\{isAdmin && \(\s+<button onClick=\{onNavigateToAccounting\}/);
});

test('Accounting Firestore data is server-only despite the signed-in fallback rule', async () => {
  const rules = await readSource('../firestore.rules');

  assert.match(rules, /match \/accounting\/\{document=\*\*\} \{\s+allow read, write: if false;/);
  assert.match(rules, /collection != 'accounting'/);
});

test('Accounting endpoints assert administrator access', async () => {
  const functionsIndex = await readSource('../functions/index.js');

  assert.match(functionsIndex, /exports\.accounting_getOverview/);
  assert.match(functionsIndex, /accounting\.getOverview\(\{authState\}\)/);
  assert.match(functionsIndex, /const authState = await assertAdminFromContext\(context\)/);
  assert.match(functionsIndex, /exports\.accounting_httpGetOverview/);
  assert.match(functionsIndex, /const authState = await assertAdmin\(req, data\)/);
  assert.match(functionsIndex, /exports\.accounting_createDraftInvoice/);
  assert.match(functionsIndex, /accounting\.createDraftInvoice\(data, authState\)/);
  assert.match(functionsIndex, /exports\.accounting_httpCreateDraftInvoice/);
});

test('Invoice UI supports per-invoice sales tax and the configured company defaults', async () => {
  const [page, accounting] = await Promise.all([
    readSource('../src/pages/AccountingPage.jsx'),
    readSource('../functions/accounting.js'),
  ]);

  assert.match(page, /legalName: 'Ocharge LLC'/);
  assert.match(page, /baseCurrency: 'USD'/);
  assert.match(page, /nextInvoiceNumber: 1000/);
  assert.match(page, /Apply sales tax to this invoice/);
  assert.match(page, /taxEnabled: draft\.taxEnabled/);
  assert.match(accounting, /startingInvoiceNumber: 1000/);
  assert.match(accounting, /invoiceTaxMode: "per_invoice"/);
});
