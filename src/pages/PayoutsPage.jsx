import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, BanknotesIcon, CheckCircleIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

const STATUS_LABELS = {
  pending_approval: 'Pending approval',
  ready_to_send: 'Ready',
  sent: 'Sent',
  paid: 'Paid',
};

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function getReportName(report) {
  if (report.type === 'lease_partner') {
    return report.partner?.name || report.partner?.clientId || 'Partner';
  }
  return report.client?.name || report.client?.clientId || 'Client';
}

function getPartnerShare(report) {
  if (report.type === 'lease_partner') {
    return Number(report.totals?.partnerShare || 0);
  }
  return (report.partnerBreakdown || []).reduce((sum, partner) => sum + Number(partner.share || 0), 0);
}

function StatusPill({ status }) {
  const tone = status === 'paid'
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : status === 'sent'
      ? 'bg-blue-100 text-blue-700 border-blue-200'
      : 'bg-amber-100 text-amber-700 border-amber-200';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function PayoutsPage({ onNavigateToDashboard, onNavigateToAdmin, onLogout, t }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callFunctionWithAuth('payouts_listReports', statusFilter ? { status: statusFilter } : {});
      setReports(Array.isArray(result.reports) ? result.reports : []);
    } catch (error) {
      console.error(error);
      setToast({ state: 'error', message: error?.message || 'Failed to load payouts.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const summary = useMemo(() => ({
    pending: reports.filter((report) => report.status === 'pending_approval').length,
    sent: reports.filter((report) => report.status === 'sent').length,
    paid: reports.filter((report) => report.status === 'paid').length,
  }), [reports]);

  const handleGenerate = async () => {
    setBusyId('generate');
    setToast({ state: 'sending', message: 'Generating payout reports...' });
    try {
      const result = await callFunctionWithAuth('payouts_generateMonthlyReports', {
        autoSendLease: false,
        notifyAdmin: false,
        includeAllSchedules: true,
      });
      setToast({ state: 'success', message: `Generated ${result.generatedCount || 0} payout report${result.generatedCount === 1 ? '' : 's'}. No emails were sent.` });
      await fetchReports();
    } catch (error) {
      console.error(error);
      setToast({ state: 'error', message: error?.message || 'Failed to generate payout reports.' });
    } finally {
      setBusyId('');
    }
  };

  const handleApprove = async (reportId) => {
    setBusyId(reportId);
    setToast({ state: 'sending', message: 'Approving and sending payout emails...' });
    try {
      await callFunctionWithAuth('payouts_approveAndSend', { reportId });
      setToast({ state: 'success', message: 'Payout emails sent.' });
      await fetchReports();
    } catch (error) {
      console.error(error);
      setToast({ state: 'error', message: error?.message || 'Failed to approve payout.' });
    } finally {
      setBusyId('');
    }
  };

  const handleMarkPaid = async (reportId) => {
    setBusyId(reportId);
    setToast({ state: 'sending', message: 'Marking payout as paid...' });
    try {
      await callFunctionWithAuth('payouts_markPaid', { reportId });
      setToast({ state: 'success', message: 'Payout marked paid.' });
      await fetchReports();
    } catch (error) {
      console.error(error);
      setToast({ state: 'error', message: error?.message || 'Failed to mark payout paid.' });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <CommandStatusToast status={toast} onDismiss={() => setToast(null)} />
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Payouts</h1>
              <p className="text-sm text-gray-500">Review revenue share reports and payment status.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateToDashboard}
              className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300"
              type="button"
              title={t('back_to_dashboard')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
            <button
              onClick={onNavigateToAdmin}
              className="rounded-md bg-orange-100 p-2 text-orange-700 hover:bg-orange-200"
              type="button"
              title={t('admin_tools')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
            <button onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title={t('logout')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-700">Pending</p>
            <p className="mt-1 text-3xl font-bold text-amber-900">{summary.pending}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-blue-700">Sent</p>
            <p className="mt-1 text-3xl font-bold text-blue-900">{summary.sent}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-700">Paid</p>
            <p className="mt-1 text-3xl font-bold text-emerald-900">{summary.paid}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[
              ['', 'All'],
              ['pending_approval', 'Pending'],
              ['sent', 'Sent'],
              ['paid', 'Paid'],
            ].map(([value, label]) => (
              <button
                key={value || 'all'}
                onClick={() => setStatusFilter(value)}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${statusFilter === value ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={busyId === 'generate'}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              type="button"
            >
              <ArrowPathIcon className={`h-4 w-4 ${busyId === 'generate' ? 'animate-spin' : ''}`} />
              Generate
            </button>
            <button
              onClick={fetchReports}
              className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              type="button"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg bg-white shadow">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <LoadingSpinner t={t} />
            </div>
          ) : reports.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <BanknotesIcon className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 font-semibold">No payout reports found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Report</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Period</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Admin</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Revenue</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Client</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Partner</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {reports.map((report) => (
                    <tr key={report.id} className="align-top">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-gray-900">{getReportName(report)}</p>
                        <p className="text-xs text-gray-500">{report.type === 'lease_partner' ? 'Lease partner payout' : 'Purchase approval'}</p>
                        <p className="mt-1 text-xs text-gray-400">{report.id}</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        <p>{report.period?.label || '-'}</p>
                        <p className="text-xs text-gray-400">{formatDate(report.generatedAt)}</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">{report.adminEmail || '-'}</td>
                      <td className="px-4 py-4 text-right text-sm font-semibold text-gray-900">{formatMoney(report.totals?.totalRevenue || report.totals?.leaseTotal)}</td>
                      <td className="px-4 py-4 text-right text-sm text-gray-700">{formatMoney(report.totals?.clientShare)}</td>
                      <td className="px-4 py-4 text-right text-sm text-gray-700">{formatMoney(getPartnerShare(report))}</td>
                      <td className="px-4 py-4"><StatusPill status={report.status} /></td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          {['pending_approval', 'ready_to_send'].includes(report.status) && (
                            <button
                              onClick={() => handleApprove(report.id)}
                              disabled={busyId === report.id}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                              type="button"
                            >
                              <PaperAirplaneIcon className="h-4 w-4" />
                              {report.status === 'ready_to_send' ? 'Send' : 'Approve'}
                            </button>
                          )}
                          {report.status === 'sent' && (
                            <button
                              onClick={() => handleMarkPaid(report.id)}
                              disabled={busyId === report.id}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                              type="button"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                              Paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
