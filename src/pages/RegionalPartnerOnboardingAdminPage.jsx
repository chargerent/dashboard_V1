import {useCallback, useEffect, useMemo, useState} from 'react';
import {ArrowPathIcon, CheckCircleIcon, UserPlusIcon} from '@heroicons/react/24/outline';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';
import {callFunctionWithAuth} from '../utils/callableRequest.js';

const PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'],
  ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
  ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'],
  ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

const INITIAL_FORM = {
  partnerType: 'company',
  contactName: '',
  contactEmail: '',
  username: '',
  clientId: '',
  province: 'ON',
  territory: '',
  testMode: true,
};

function usernameSuggestion(email) {
  return String(email || '').split('@')[0].toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 64);
}

function clientIdSuggestion(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9_-]+/g, '').slice(0, 24);
}

function statusLabel(invite) {
  if (invite.activation?.status === 'active') return 'Dashboard active';
  if (invite.agreementStatus === 'signed') return 'Ready for approval';
  if (invite.agreementStatus === 'awaiting_signature') return 'Awaiting signature';
  return 'Invitation sent';
}

function statusClasses(invite) {
  if (invite.activation?.status === 'active') return 'bg-emerald-100 text-emerald-800';
  if (invite.agreementStatus === 'signed') return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
}

export default function RegionalPartnerOnboardingAdminPage({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onLogout,
  previewMode = false,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activatingId, setActivatingId] = useState('');
  const [message, setMessage] = useState(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState('');

  const canSubmit = useMemo(() => [
    form.partnerType, form.contactName, form.contactEmail, form.username, form.clientId,
    form.province, form.territory,
  ].every(Boolean), [form]);

  const loadInvitations = useCallback(async () => {
    if (previewMode) {
      setInvitations([{
        id: 'preview-ready',
        contactName: 'Alex Partner',
        contactEmail: 'alex@example.ca',
        clientId: 'AB-NORTH',
        partnerType: 'company',
        province: 'AB',
        territory: 'Edmonton and Northern Alberta',
        status: 'ready_for_approval',
        agreementStatus: 'signed',
        activation: {status: 'not_ready'},
        notificationStatus: 'sent',
        testMode: true,
        createdAt: new Date().toISOString(),
      }]);
      setLoading(false);
      return;
    }
    try {
      const result = await callFunctionWithAuth('admin_listRegionalPartnerInvites');
      setInvitations(Array.isArray(result?.invitations) ? result.invitations : []);
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'Partner invitations could not be loaded.'});
    } finally {
      setLoading(false);
    }
  }, [previewMode]);

  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  const updateForm = (key, value) => setForm((previous) => ({...previous, [key]: value}));

  const submitInvite = async (event) => {
    event.preventDefault();
    if (!canSubmit || submitting || previewMode) return;
    if (form.province === 'QC') {
      setMessage({type: 'error', text: 'Quebec is paused until the approved French agreement is available.'});
      return;
    }
    setSubmitting(true);
    setMessage(null);
    setCreatedInviteUrl('');
    try {
      const result = await callFunctionWithAuth('admin_createRegionalPartnerInvite', form, {timeoutMs: 120000});
      setCreatedInviteUrl(result?.inviteUrl || '');
      setMessage({
        type: result?.notificationStatus === 'sent' ? 'success' : 'warning',
        text: result?.notificationStatus === 'sent'
          ? 'The Canadian regional partner invitation was created and emailed.'
          : 'The invitation was created, but email delivery could not be confirmed. Copy the secure link below.',
      });
      setForm(INITIAL_FORM);
      await loadInvitations();
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The invitation could not be created.'});
    } finally {
      setSubmitting(false);
    }
  };

  const activate = async (invite) => {
    if (!invite?.id || activatingId || previewMode) return;
    setActivatingId(invite.id);
    setMessage(null);
    try {
      const result = await callFunctionWithAuth('admin_activateRegionalPartner', {inviteId: invite.id}, {timeoutMs: 120000});
      setMessage({
        type: result?.emailStatus === 'sent' ? 'success' : 'warning',
        text: result?.emailStatus === 'sent'
          ? `${invite.contactName}'s dashboard was activated and their password-setup email was sent.`
          : `${invite.contactName}'s dashboard was activated, but email delivery could not be confirmed.`,
      });
      await loadInvitations();
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The partner could not be activated.'});
    } finally {
      setActivatingId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Chargerent</p>
            <h1 className="text-xl font-bold text-slate-900">Regional Partner Onboarding</h1>
          </div>
          <DashboardPageActions
            onNavigateToDashboard={onNavigateToDashboard}
            onNavigateToAdmin={onNavigateToAdmin}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-violet-100 p-2 text-violet-700"><UserPlusIcon className="h-6 w-6" /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Invite a Canadian partner</h2>
              <p className="text-sm text-slate-500">Chargerent Inc · CAD · 40% partner-controlled pool</p>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            No dashboard password is sent now. Access is activated only after the agreement is signed and an administrator approves the account. Canadian payout setup will be added separately later.
          </div>
          {message && (
            <div className={`mt-5 rounded-xl border p-4 text-sm ${message.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : message.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {message.text}
            </div>
          )}
          {createdInviteUrl && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Secure invitation link</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={createdInviteUrl} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs" />
                <button type="button" onClick={() => navigator.clipboard?.writeText(createdInviteUrl)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Copy</button>
              </div>
            </div>
          )}
          <form onSubmit={submitInvite} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Partner type</span>
              <select value={form.partnerType} onChange={(e) => updateForm('partnerType', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="company">Company or organization</option>
                <option value="individual">Individual</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Contact name</span>
              <input required value={form.contactName} onChange={(e) => updateForm('contactName', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Contact email</span>
              <input required type="email" value={form.contactEmail} onChange={(e) => {
                updateForm('contactEmail', e.target.value);
                if (!form.username) updateForm('username', usernameSuggestion(e.target.value));
              }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Dashboard username</span>
              <input required value={form.username} onChange={(e) => updateForm('username', e.target.value.toLowerCase())} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Partner ID</span>
              <input required value={form.clientId} onChange={(e) => updateForm('clientId', clientIdSuggestion(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" />
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Province or territory</span>
              <select value={form.province} onChange={(e) => updateForm('province', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}{code === 'QC' ? ' (not yet available)' : ''}</option>)}
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold text-slate-700">Canadian territory</span>
              <input required placeholder="Edmonton and Northern Alberta" value={form.territory} onChange={(e) => updateForm('territory', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:col-span-2">
              <input type="checkbox" checked={form.testMode} onChange={(e) => updateForm('testMode', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600" />
              <span><strong>Test invitation.</strong> Keep this selected for internal workflow testing. Clear it only when you are ready to invite a real partner.</span>
            </label>
            <button type="submit" disabled={!canSubmit || submitting || previewMode} className="sm:col-span-2 rounded-xl bg-violet-600 px-5 py-3 font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Creating invitation…' : previewMode ? 'Preview mode' : 'Create and email invitation'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Onboarding pipeline</h2>
              <p className="text-sm text-slate-500">Profile → agreement → approval</p>
            </div>
            <button type="button" onClick={() => void loadInvitations()} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Refresh">
              <ArrowPathIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-5 space-y-3">
            {loading && <p className="py-8 text-center text-sm text-slate-500">Loading invitations…</p>}
            {!loading && invitations.length === 0 && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No regional partner invitations yet.</p>}
            {invitations.map((invite) => {
              const profileComplete = ['awaiting_signature', 'signed'].includes(invite.agreementStatus);
              const ready = invite.agreementStatus === 'signed' && invite.activation?.status !== 'active';
              return (
                <article key={invite.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{invite.contactName}{invite.testMode && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-800">Test</span>}</p>
                      <p className="text-sm text-slate-600">{invite.clientId} · {invite.territory} · {invite.partnerType === 'individual' ? 'Individual' : 'Company'}</p>
                      <p className="mt-1 text-xs text-slate-500">{invite.contactEmail}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClasses(invite)}`}>{statusLabel(invite)}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className={`rounded-lg p-2 ${profileComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                      <CheckCircleIcon className="mx-auto h-4 w-4" /> Profile
                    </div>
                    <div className={`rounded-lg p-2 ${invite.agreementStatus === 'signed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                      <CheckCircleIcon className="mx-auto h-4 w-4" /> Agreement
                    </div>
                    <div className={`rounded-lg p-2 ${invite.activation?.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                      <CheckCircleIcon className="mx-auto h-4 w-4" /> Access
                    </div>
                  </div>
                  {ready && (
                    <button type="button" disabled={activatingId === invite.id || previewMode} onClick={() => void activate(invite)} className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {activatingId === invite.id ? 'Activating…' : 'Approve and activate dashboard'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
