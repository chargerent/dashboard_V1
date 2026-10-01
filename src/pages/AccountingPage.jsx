import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckBadgeIcon,
  DocumentTextIcon,
  LockClosedIcon,
  PlusIcon,
  ScaleIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';

const PREVIEW_OVERVIEW = Object.freeze({
  company: {
    configured: true,
    legalName: 'Ocharge LLC',
    baseCurrency: 'USD',
    timezone: 'America/Phoenix',
    nextInvoiceNumber: 1000,
    openInvoiceCount: 0,
    overdueInvoiceCount: 0,
    openInvoiceCents: 0,
    unreviewedTransactionCount: 0,
    lastReconciledBalanceCents: 0,
    lastReconciledThrough: null,
  },
  bankConnections: [],
  recentInvoices: [],
  latestReconciliation: null,
  capabilities: {
    invoicing: true,
    manualBankImport: true,
    bankFeedReadOnly: true,
    plaidStatus: 'not_configured',
  },
});

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function newInvoiceDraft() {
  const issued = new Date();
  const due = new Date(issued);
  due.setDate(due.getDate() + 30);
  return {
    requestId: globalThis.crypto?.randomUUID?.() || `invoice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerName: '',
    customerEmail: '',
    issueDate: dateInputValue(issued),
    dueDate: dateInputValue(due),
    taxEnabled: false,
    taxRatePercent: '',
    lineItems: [{description: '', quantity: '1', unitPrice: ''}],
  };
}

function invoicePayload(draft, currency) {
  return {
    requestId: draft.requestId,
    customerName: draft.customerName,
    customerEmail: draft.customerEmail,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    currency,
    taxEnabled: draft.taxEnabled,
    taxRateBps: draft.taxEnabled ? Math.round(Number(draft.taxRatePercent) * 100) : 0,
    lineItems: draft.lineItems.map((item) => ({
      description: item.description,
      quantityMillis: Math.round(Number(item.quantity) * 1000),
      unitPriceCents: Math.round(Number(item.unitPrice) * 100),
    })),
  };
}

function calculateDraftTotals(payload) {
  const subtotalCents = payload.lineItems.reduce((total, item) => (
    total + Math.round((item.quantityMillis * item.unitPriceCents) / 1000)
  ), 0);
  const taxCents = payload.taxEnabled ? Math.round((subtotalCents * payload.taxRateBps) / 10000) : 0;
  return {subtotalCents, taxCents, totalCents: subtotalCents + taxCents};
}

function formatMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(cents || 0) / 100);
}

function SummaryCard({icon: Icon, label, value, detail, tone}) {
  return (
    <div className={`rounded-2xl border p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold opacity-75">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs opacity-70">{detail}</p>
        </div>
        <Icon className="h-7 w-7 opacity-70" />
      </div>
    </div>
  );
}

function EmptyPanel({icon: Icon, title, description, action}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-7 text-center">
      <Icon className="mx-auto h-9 w-9 text-slate-300" />
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action}
    </div>
  );
}

function InvoiceComposer({company, onCancel, onCreate, saving}) {
  const [draft, setDraft] = useState(newInvoiceDraft);
  const payload = useMemo(() => invoicePayload(draft, company.baseCurrency || 'USD'), [company.baseCurrency, draft]);
  const totals = useMemo(() => calculateDraftTotals(payload), [payload]);
  const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100';

  const updateLineItem = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) => itemIndex === index ? {...item, [field]: value} : item),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    await onCreate(payload);
  };

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-white shadow-lg">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold">New invoice #{company.nextInvoiceNumber || 1000}</h2>
          <p className="mt-1 text-sm text-slate-500">{company.legalName || 'Ocharge LLC'} · {company.baseCurrency || 'USD'} · Saved as a draft</p>
        </div>
        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onCancel} title="Close invoice" type="button">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <form className="p-5" onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Customer name
            <input className={inputClass} maxLength={160} onChange={(event) => setDraft({...draft, customerName: event.target.value})} required value={draft.customerName} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Customer email <span className="font-normal text-slate-400">optional</span>
            <input className={inputClass} onChange={(event) => setDraft({...draft, customerEmail: event.target.value})} type="email" value={draft.customerEmail} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Issue date
            <input className={inputClass} onChange={(event) => setDraft({...draft, issueDate: event.target.value})} required type="date" value={draft.issueDate} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Due date
            <input className={inputClass} min={draft.issueDate} onChange={(event) => setDraft({...draft, dueDate: event.target.value})} required type="date" value={draft.dueDate} />
          </label>
        </div>

        <div className="mt-6">
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[620px]">
              <div className="mb-2 grid grid-cols-[minmax(0,1fr)_90px_130px_36px] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>Description</span><span>Quantity</span><span>Unit price</span><span />
              </div>
              <div className="space-y-2">
                {draft.lineItems.map((item, index) => (
                  <div className="grid grid-cols-[minmax(0,1fr)_90px_130px_36px] items-center gap-2" key={`${draft.requestId}-${index}`}>
                    <input aria-label={`Line ${index + 1} description`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" maxLength={240} onChange={(event) => updateLineItem(index, 'description', event.target.value)} required value={item.description} />
                    <input aria-label={`Line ${index + 1} quantity`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" min="0.001" onChange={(event) => updateLineItem(index, 'quantity', event.target.value)} required step="0.001" type="number" value={item.quantity} />
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">$</span>
                      <input aria-label={`Line ${index + 1} unit price`} className="w-full rounded-lg border border-slate-300 py-2 pl-7 pr-3 text-sm" min="0" onChange={(event) => updateLineItem(index, 'unitPrice', event.target.value)} required step="0.01" type="number" value={item.unitPrice} />
                    </div>
                    <button
                      aria-label={`Remove line ${index + 1}`}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={draft.lineItems.length === 1}
                      onClick={() => setDraft((current) => ({...current, lineItems: current.lineItems.filter((_, itemIndex) => itemIndex !== index)}))}
                      type="button"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <button
            className="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50"
            onClick={() => setDraft((current) => ({...current, lineItems: [...current.lineItems, {description: '', quantity: '1', unitPrice: ''}]}))}
            type="button"
          >
            <PlusIcon className="h-4 w-4" /> Add line
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 border-t border-slate-200 pt-5 md:grid-cols-2">
          <div>
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
              <input
                checked={draft.taxEnabled}
                className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                onChange={(event) => setDraft({...draft, taxEnabled: event.target.checked, taxRatePercent: event.target.checked ? draft.taxRatePercent : ''})}
                type="checkbox"
              />
              Apply sales tax to this invoice
            </label>
            <p className="mt-1 pl-8 text-xs text-slate-500">Leave this off for non-taxable or tax-exempt invoices.</p>
            {draft.taxEnabled && (
              <label className="mt-4 block max-w-[180px] text-sm font-semibold text-slate-700">
                Sales tax rate
                <div className="relative">
                  <input className={`${inputClass} pr-8`} max="25" min="0.01" onChange={(event) => setDraft({...draft, taxRatePercent: event.target.value})} required step="0.01" type="number" value={draft.taxRatePercent} />
                  <span className="pointer-events-none absolute right-3 top-3 text-sm text-slate-400">%</span>
                </div>
              </label>
            )}
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-semibold">{formatMoney(totals.subtotalCents, company.baseCurrency)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Sales tax{draft.taxEnabled && draft.taxRatePercent ? ` (${draft.taxRatePercent}%)` : ''}</span><span className="font-semibold">{formatMoney(totals.taxCents, company.baseCurrency)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-bold">Total</span><span className="font-bold">{formatMoney(totals.totalCents, company.baseCurrency)}</span></div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200" disabled={saving} onClick={onCancel} type="button">Cancel</button>
          <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300" disabled={saving} type="submit">
            {saving ? 'Saving…' : `Save draft #${company.nextInvoiceNumber || 1000}`}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function AccountingPage({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onLogout,
  previewMode = false,
  t = (key) => key,
}) {
  const [overview, setOverview] = useState(previewMode ? PREVIEW_OVERVIEW : null);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState('');
  const [showInvoiceComposer, setShowInvoiceComposer] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [notice, setNotice] = useState('');

  const loadOverview = useCallback(async () => {
    if (previewMode) {
      setOverview(PREVIEW_OVERVIEW);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setOverview(await callFunctionWithAuth('accounting_getOverview'));
    } catch (loadError) {
      console.error(loadError);
      setError(loadError?.message || 'Accounting could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [previewMode]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const company = overview?.company || PREVIEW_OVERVIEW.company;
  const bankConnections = overview?.bankConnections || [];
  const recentInvoices = overview?.recentInvoices || [];
  const activeBankConnection = bankConnections.find((connection) => connection.status === 'connected') || null;
  const currency = company.baseCurrency || 'USD';
  const reconciliation = overview?.latestReconciliation || null;
  const reconciliationStatus = useMemo(() => {
    if (!reconciliation) return 'Not started';
    if (reconciliation.status === 'completed') return 'Reconciled';
    return 'In progress';
  }, [reconciliation]);

  const createDraftInvoice = async (payload) => {
    setSavingInvoice(true);
    setError('');
    setNotice('');
    try {
      if (previewMode) {
        const totals = calculateDraftTotals(payload);
        const invoiceNumber = String(company.nextInvoiceNumber || 1000);
        const invoice = {
          id: `preview-${payload.requestId}`,
          invoiceNumber,
          customerName: payload.customerName.trim(),
          status: 'draft',
          currency: payload.currency,
          balanceDueCents: totals.totalCents,
          totalCents: totals.totalCents,
          subtotalCents: totals.subtotalCents,
          taxEnabled: payload.taxEnabled,
          taxRateBps: payload.taxRateBps,
          taxCents: totals.taxCents,
          issueDate: payload.issueDate,
          dueDate: payload.dueDate,
        };
        setOverview((current) => ({
          ...current,
          company: {...current.company, configured: true, nextInvoiceNumber: Number(invoiceNumber) + 1},
          recentInvoices: [invoice, ...(current.recentInvoices || [])].slice(0, 5),
        }));
        setNotice(`Draft invoice #${invoiceNumber} created locally for preview.`);
      } else {
        const result = await callFunctionWithAuth('accounting_createDraftInvoice', payload);
        setNotice(result.duplicate
          ? `Draft invoice #${result.invoice?.invoiceNumber || ''} was already created.`
          : `Draft invoice #${result.invoice?.invoiceNumber || ''} created.`);
        await loadOverview();
      }
      setShowInvoiceComposer(false);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError?.message || 'Invoice could not be created.');
    } finally {
      setSavingInvoice(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Accounting</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                <LockClosedIcon className="h-3.5 w-3.5" /> Admin only
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {company.legalName || 'Ocharge LLC'} · {currency} · Next invoice #{company.nextInvoiceNumber || 1000}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              onClick={() => { setShowInvoiceComposer(true); setError(''); setNotice(''); }}
              type="button"
            >
              <PlusIcon className="h-4 w-4" /> New invoice
            </button>
            <button
              className="rounded-lg bg-slate-100 p-2 text-slate-700 hover:bg-slate-200"
              onClick={loadOverview}
              title="Refresh accounting"
              type="button"
            >
              <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <DashboardPageActions
              onNavigateToDashboard={onNavigateToDashboard}
              onNavigateToAdmin={onNavigateToAdmin}
              onLogout={onLogout}
              t={t}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </div>
        )}

        {showInvoiceComposer && (
          <InvoiceComposer
            company={company}
            onCancel={() => { if (!savingInvoice) setShowInvoiceComposer(false); }}
            onCreate={createDraftInvoice}
            saving={savingInvoice}
          />
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryCard
            icon={DocumentTextIcon}
            label="Open invoices"
            value={formatMoney(company.openInvoiceCents, currency)}
            detail={`${company.openInvoiceCount} open · ${company.overdueInvoiceCount} overdue`}
            tone="border-blue-200 bg-blue-50 text-blue-950"
          />
          <SummaryCard
            icon={BuildingLibraryIcon}
            label="Bank transactions to review"
            value={company.unreviewedTransactionCount}
            detail={activeBankConnection ? `Last sync ${activeBankConnection.lastSyncedAt || 'pending'}` : 'No bank connected'}
            tone="border-violet-200 bg-violet-50 text-violet-950"
          />
          <SummaryCard
            icon={ScaleIcon}
            label="Reconciliation"
            value={reconciliationStatus}
            detail={company.lastReconciledThrough ? `Through ${company.lastReconciledThrough}` : 'No completed statement'}
            tone="border-emerald-200 bg-emerald-50 text-emerald-950"
          />
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BuildingLibraryIcon className="h-6 w-6 text-violet-600" />
                <h2 className="text-lg font-bold">Chase bank feed</h2>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                The feed will be read-only. Imported transactions will enter a review queue and will not post themselves to the ledger.
              </p>
            </div>
            {activeBankConnection ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
                <CheckBadgeIcon className="h-5 w-5" /> {activeBankConnection.institutionName || 'Bank'} connected
              </span>
            ) : (
              <button
                className="cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
                disabled
                title="Plaid production configuration is required first"
                type="button"
              >
                Connect Chase
              </button>
            )}
          </div>
          {!activeBankConnection && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Plaid is not configured yet. The connection button will be enabled after the Plaid application, secrets, OAuth redirect, and webhook verification are complete.
            </div>
          )}
        </section>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Recent invoices</h2>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phase 1</span>
            </div>
            {recentInvoices.length === 0 ? (
              <EmptyPanel
                icon={DocumentTextIcon}
                title="No invoices yet"
                description="Create the first Ocharge LLC invoice. Numbering begins at 1000 and sales tax is controlled per invoice."
                action={(
                  <button
                    className="mt-4 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                    onClick={() => { setShowInvoiceComposer(true); setError(''); setNotice(''); }}
                    type="button"
                  >
                    <PlusIcon className="h-4 w-4" /> New invoice
                  </button>
                )}
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {recentInvoices.map((invoice) => (
                  <div className="flex items-center justify-between border-b border-slate-100 p-4 last:border-b-0" key={invoice.id}>
                    <div>
                      <p className="font-semibold">{invoice.invoiceNumber || 'Draft invoice'}</p>
                      <p className="text-sm text-slate-500">{invoice.customerName || 'No customer'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(invoice.balanceDueCents, invoice.currency)}</p>
                      <p className="text-xs uppercase tracking-wide text-slate-400">{invoice.status}</p>
                      <p className="mt-1 text-xs text-slate-400">{invoice.taxEnabled ? `${(invoice.taxRateBps / 100).toFixed(2)}% tax` : 'No sales tax'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Statement reconciliation</h2>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phase 1</span>
            </div>
            {!reconciliation ? (
              <EmptyPanel
                icon={ScaleIcon}
                title="No reconciliation started"
                description="A reconciliation will compare the statement ending balance with cleared ledger entries and lock the completed period."
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6">
                <p className="text-sm text-slate-500">Statement ending balance</p>
                <p className="mt-1 text-2xl font-bold">{formatMoney(reconciliation.statementEndingBalanceCents, currency)}</p>
                <p className={`mt-3 text-sm font-semibold ${reconciliation.differenceCents === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  Difference: {formatMoney(reconciliation.differenceCents, currency)}
                </p>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-8 flex items-center gap-2 text-xs text-slate-500">
          <BanknotesIcon className="h-4 w-4" /> Accounting records are available only through admin-authorized server functions.
        </footer>
      </main>
    </div>
  );
}
