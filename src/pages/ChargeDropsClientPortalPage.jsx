import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ArrowDownTrayIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BuildingStorefrontIcon,
  DocumentCheckIcon,
  MapPinIcon,
  PowerIcon,
} from '@heroicons/react/24/outline';
import {callFunctionWithAuth} from '../utils/callableRequest.js';

const EXCLUDED_RENTAL_STATUSES = new Set(['purchased', 'purchase-pending', 'purchased-pending']);

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function eligibleRental(rental) {
  if (rental?.excludeFromReporting) return false;
  const status = String(rental?.reportingStatus || rental?.status || '').toLowerCase();
  const returnType = String(rental?.reportingReturnType || rental?.returnType || '').toLowerCase();
  return !EXCLUDED_RENTAL_STATUSES.has(status) && returnType !== 'vend-reset';
}

function stationName(station) {
  return station?.info?.place || station?.info?.location || station?.stationid || 'ChargeDrops station';
}

function stationAddress(station) {
  return station?.info?.address || station?.info?.stationaddress || '';
}

function stationIsOnline(station) {
  const explicitStatus = String(station?.status || station?.active?.status || '').toLowerCase();
  if (['online', 'active', 'connected'].includes(explicitStatus)) return true;
  if (['offline', 'inactive', 'disconnected'].includes(explicitStatus)) return false;
  return station?.active === true || station?.connected === true;
}

function agreementStatusLabel(status) {
  if (status === 'signed') return 'Client signed';
  if (status === 'awaiting_signature') return 'Ready to sign';
  if (status === 'voided') return 'Voided';
  return 'Not prepared';
}

function StatCard({icon: Icon, label, value, note, accent = 'indigo'}) {
  const iconStyle = accent === 'emerald'
    ? 'bg-emerald-100 text-emerald-700'
    : accent === 'amber'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-indigo-100 text-indigo-700';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconStyle}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

export default function ChargeDropsClientPortalPage({clientInfo, stations = [], rentals = [], onLogout, previewMode = false}) {
  const sharePercent = Number(clientInfo?.commission || clientInfo?.revShare || 0);
  const location = clientInfo?.chargedrops?.location || {};
  const city = clientInfo?.chargedrops?.city || {};
  const onboarding = clientInfo?.chargedrops?.onboarding || {};
  const qualifyingRentals = useMemo(() => rentals.filter(eligibleRental), [rentals]);
  const grossRevenue = useMemo(
    () => qualifyingRentals.reduce((sum, rental) => sum + (Number(rental?.totalCharged) || 0), 0),
    [qualifyingRentals],
  );
  const clientShare = grossRevenue * (sharePercent / 100);
  const onlineCount = stations.filter(stationIsOnline).length;
  const savedPayout = clientInfo?.chargedrops?.payout || {};
  const savedAgreement = clientInfo?.chargedrops?.agreement || {};
  const [agreement, setAgreement] = useState(previewMode ? {
    id: 'preview-agreement',
    title: 'ChargeRent Revenue Share Agreement',
    version: 'V.11.01.2024',
    status: 'awaiting_signature',
    canSign: true,
    agreementUrl: '',
  } : {
    ...savedAgreement,
    status: savedAgreement.status || onboarding.agreementStatus || 'not_prepared',
  });
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementError, setAgreementError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [signatureForm, setSignatureForm] = useState({
    signerName: clientInfo?.contact?.name || '',
    signerTitle: '',
    code: '',
    reviewedDocument: false,
    consentElectronic: false,
    intentToSign: false,
  });
  const [payout, setPayout] = useState({
    status: savedPayout.status || (onboarding.payoutStatus === 'complete' ? 'complete' : 'not_started'),
    ready: savedPayout.ready === true || onboarding.payoutStatus === 'complete',
    mode: savedPayout.mode || '',
    requirementsDue: Number(savedPayout.requirementsDue || 0),
  });
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutError, setPayoutError] = useState('');
  const agreementSigned = agreement.status === 'signed';

  const refreshAgreementStatus = useCallback(async () => {
    if (previewMode) return null;
    const result = await callFunctionWithAuth('chargedrops_agreementStatus', {}, {timeoutMs: 30000});
    setAgreement(result);
    return result;
  }, [previewMode]);

  const openAgreement = () => {
    if (previewMode) return;
    if (!String(agreement.agreementUrl || '').startsWith('https://')) {
      setAgreementError('The secure agreement link has expired. Refresh the page and try again.');
      return;
    }
    window.open(agreement.agreementUrl, '_blank', 'noopener,noreferrer');
  };

  const requestAgreementCode = async () => {
    if (agreementBusy || previewMode) return;
    setAgreementBusy(true);
    setAgreementError('');
    setVerificationMessage('');
    try {
      const result = await callFunctionWithAuth('chargedrops_requestAgreementCode', {}, {timeoutMs: 30000});
      setVerificationMessage(`A six-digit code was sent to ${result?.emailMasked || 'your email address'}.`);
    } catch (error) {
      setAgreementError(error?.message || 'The verification code could not be sent.');
    } finally {
      setAgreementBusy(false);
    }
  };

  const signAgreement = async () => {
    if (agreementBusy || previewMode) return;
    setAgreementBusy(true);
    setAgreementError('');
    try {
      const result = await callFunctionWithAuth('chargedrops_signAgreement', signatureForm, {timeoutMs: 120000});
      setAgreement(result?.agreement || {status: 'signed'});
      setVerificationMessage('Your signature was recorded and a client-signed copy was emailed to you.');
      setSignatureForm((previous) => ({...previous, code: ''}));
    } catch (error) {
      setAgreementError(error?.message || 'The agreement could not be signed.');
    } finally {
      setAgreementBusy(false);
    }
  };

  const refreshPayoutStatus = useCallback(async () => {
    if (previewMode) return {
      status: 'requirements_due',
      ready: false,
      mode: 'test',
      requirementsDue: 2,
    };
    const result = await callFunctionWithAuth('chargedrops_stripeStatus', {}, {timeoutMs: 30000});
    setPayout(result);
    return result;
  }, [previewMode]);

  const openPayoutSetup = useCallback(async () => {
    if (payoutBusy || previewMode) return;
    if (!agreementSigned) {
      setPayoutError('Sign the ChargeDrops agreement before setting up payouts.');
      return;
    }
    setPayoutBusy(true);
    setPayoutError('');
    try {
      const result = await callFunctionWithAuth('chargedrops_stripeOnboardingLink', {}, {timeoutMs: 30000});
      if (!String(result?.url || '').startsWith('https://connect.stripe.com/')) {
        throw new Error('Stripe did not return a secure onboarding page.');
      }
      window.location.assign(result.url);
    } catch (error) {
      setPayoutError(error?.message || 'Stripe payout setup is temporarily unavailable.');
      setPayoutBusy(false);
    }
  }, [agreementSigned, payoutBusy, previewMode]);

  useEffect(() => {
    let canceled = false;
    if (previewMode) return undefined;
    setAgreementBusy(true);
    refreshAgreementStatus()
      .catch((error) => {
        if (!canceled) setAgreementError(error?.message || 'Agreement status could not be loaded.');
      })
      .finally(() => {
        if (!canceled) setAgreementBusy(false);
      });
    return () => { canceled = true; };
  }, [previewMode, refreshAgreementStatus]);

  useEffect(() => {
    let canceled = false;
    const payoutReturn = new URLSearchParams(window.location.search).get('chargedropsPayout');

    async function initializePayout() {
      if (previewMode) return;
      setPayoutBusy(true);
      setPayoutError('');
      try {
        if (payoutReturn === 'refresh') {
          const result = await callFunctionWithAuth('chargedrops_stripeOnboardingLink', {}, {timeoutMs: 30000});
          if (!canceled && String(result?.url || '').startsWith('https://connect.stripe.com/')) {
            window.location.assign(result.url);
            return;
          }
        }
        const status = await refreshPayoutStatus();
        if (!canceled) setPayout(status);
        if (payoutReturn) {
          const url = new URL(window.location.href);
          url.searchParams.delete('chargedropsPayout');
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
      } catch (error) {
        if (!canceled) setPayoutError(error?.message || 'Payout status could not be loaded.');
      } finally {
        if (!canceled) setPayoutBusy(false);
      }
    }

    initializePayout();
    return () => { canceled = true; };
  }, [previewMode, refreshPayoutStatus]);

  const payoutLabel = payout.ready
    ? 'Complete'
    : payout.status === 'verification_pending'
      ? 'Stripe review'
      : payout.status === 'requirements_due'
        ? 'Action required'
        : payout.status === 'in_progress'
          ? 'In progress'
          : 'Not started';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white">
              <img src="/chargedrops-drop.svg" alt="ChargeDrops" className="h-9 w-6" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">ChargeDrops</p>
              <h1 className="text-lg font-bold">Client Portal</h1>
            </div>
          </div>
          <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            <PowerIcon className="h-4 w-4" /> Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-blue-500 p-6 text-white shadow-lg sm:p-8">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold text-indigo-100">Welcome back</p>
              <h2 className="mt-1 text-3xl font-bold tracking-tight">{location.venueName || clientInfo?.username || 'Your ChargeDrops location'}</h2>
              <p className="mt-3 flex items-center gap-2 text-sm text-indigo-100">
                <MapPinIcon className="h-4 w-4" /> {location.address || city.displayName || 'Location details pending'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-indigo-100">Account</p>
              <p className="mt-1 font-semibold">{clientInfo?.clientId}</p>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={BuildingStorefrontIcon} label="Your kiosks" value={stations.length} note={`${onlineCount} currently online`} />
          <StatCard icon={ArrowTrendingUpIcon} label="Qualifying revenue" value={money(grossRevenue)} note="Available reporting period" accent="emerald" />
          <StatCard icon={BanknotesIcon} label="Your revenue share" value={money(clientShare)} note={`${sharePercent}% of qualifying revenue`} accent="amber" />
          <StatCard icon={BanknotesIcon} label="Payment schedule" value={String(clientInfo?.paymentSchedule || 'monthly').replace(/^./, (letter) => letter.toUpperCase())} note={`Stripe payout account: ${payoutLabel}`} />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Kiosks at your location</h2>
                <p className="mt-1 text-sm text-slate-500">Only stations assigned to your client account appear here.</p>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">{stations.length} total</span>
            </div>
            <div className="mt-5 space-y-3">
              {stations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                  <p className="font-semibold text-slate-700">No kiosk has been assigned yet.</p>
                  <p className="mt-1 text-sm text-slate-500">Your ChargeDrops administrator will connect the station during installation.</p>
                </div>
              ) : stations.map((station) => {
                const online = stationIsOnline(station);
                return (
                  <article key={station.provisionid || station.stationid} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-bold text-slate-900">{stationName(station)}</p>
                      <p className="mt-1 text-sm text-slate-500">{stationAddress(station) || 'Address on file'}</p>
                      <p className="mt-1 text-xs text-slate-400">{station.stationid}</p>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Onboarding</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="text-slate-600">Profile</span><span className="font-semibold text-emerald-700">Complete</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-slate-600">Agreement</span><span className={`font-semibold ${agreementSigned ? 'text-emerald-700' : 'text-amber-700'}`}>{agreementStatusLabel(agreement.status)}</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-slate-600">Payout account</span><span className={`font-semibold ${payout.ready ? 'text-emerald-700' : 'text-amber-700'}`}>{payoutLabel}</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-slate-600">Public map</span><span className="font-semibold text-indigo-700">{onboarding.publicMapStatus === 'published' ? 'Published' : 'Coming soon'}</span></div>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <DocumentCheckIcon className="h-5 w-5 text-indigo-600" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Client agreement</p>
                    {agreement.version && <p className="text-xs text-slate-500">{agreement.title} · {agreement.version}</p>}
                  </div>
                </div>

                {agreement.status === 'not_prepared' || agreement.status === 'not_sent' ? (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    Your ChargeDrops administrator is preparing the agreement.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={openAgreement}
                    disabled={agreementBusy || previewMode}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    {agreementSigned ? 'View signed agreement' : 'Review complete agreement'}
                  </button>
                )}

                {agreement.status === 'awaiting_signature' && (
                  <div className="mt-4 space-y-3">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-600">Legal name</span>
                      <input
                        type="text"
                        value={signatureForm.signerName}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, signerName: event.target.value}))}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-600">Title</span>
                      <input
                        type="text"
                        value={signatureForm.signerTitle}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, signerTitle: event.target.value}))}
                        placeholder="Owner, General Manager, etc."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={signatureForm.reviewedDocument}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, reviewedDocument: event.target.checked}))}
                        className="mt-1 rounded border-slate-300 text-indigo-600"
                      />
                      I reviewed and can download the complete agreement identified above.
                    </label>
                    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={signatureForm.consentElectronic}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, consentElectronic: event.target.checked}))}
                        className="mt-1 rounded border-slate-300 text-indigo-600"
                      />
                      I consent to receive, sign, and retain this agreement electronically.
                    </label>
                    <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                      <input
                        type="checkbox"
                        checked={signatureForm.intentToSign}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, intentToSign: event.target.checked}))}
                        className="mt-1 rounded border-slate-300 text-indigo-600"
                      />
                      I adopt my typed name as my electronic signature and intend to be legally bound.
                    </label>
                    <button
                      type="button"
                      onClick={requestAgreementCode}
                      disabled={agreementBusy || previewMode}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {agreementBusy ? 'Please wait…' : 'Email verification code'}
                    </button>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-600">Six-digit code</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={signatureForm.code}
                        onChange={(event) => setSignatureForm((previous) => ({...previous, code: event.target.value.replace(/\D/g, '').slice(0, 6)}))}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-bold tracking-[0.35em] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={signAgreement}
                      disabled={agreementBusy || previewMode || signatureForm.code.length !== 6}
                      className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                    >
                      {previewMode ? 'Signing disabled in preview' : agreementBusy ? 'Signing…' : 'Sign agreement'}
                    </button>
                  </div>
                )}
                {verificationMessage && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">{verificationMessage}</p>}
                {agreementError && <p className="mt-3 text-xs font-semibold leading-5 text-rose-700">{agreementError}</p>}
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                {payout.mode === 'test' && (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Stripe test mode · no real commission payouts</p>
                )}
                <button
                  type="button"
                  onClick={openPayoutSetup}
                  disabled={payoutBusy || previewMode || !agreementSigned}
                  className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                >
                  {!agreementSigned ? 'Available after agreement signing' : previewMode ? 'Stripe action disabled in preview' : payoutBusy ? 'Opening Stripe…' : payout.ready ? 'Manage payout account' : payout.status === 'not_started' ? 'Set up commission payouts' : 'Continue Stripe setup'}
                </button>
                <p className="mt-2 text-xs leading-5 text-slate-500">Bank details are entered directly on Stripe&apos;s secure site and are never stored by ChargeDrops.</p>
                {payout.requirementsDue > 0 && <p className="mt-2 text-xs font-semibold text-amber-700">Stripe still needs {payout.requirementsDue} item{payout.requirementsDue === 1 ? '' : 's'}.</p>}
                {payoutError && <p className="mt-2 text-xs font-semibold text-rose-700">{payoutError}</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">Location profile</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Venue</dt><dd className="mt-1 text-slate-700">{location.venueName || 'Pending'}</dd></div>
                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">City</dt><dd className="mt-1 text-slate-700">{city.displayName || location.city || 'Pending'}</dd></div>
                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Phone</dt><dd className="mt-1 text-slate-700">{location.phone || 'Not listed'}</dd></div>
                <div><dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Website</dt><dd className="mt-1 break-words text-slate-700">{location.website || 'Not listed'}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
