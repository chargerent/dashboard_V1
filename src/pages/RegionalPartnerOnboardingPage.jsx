import {useCallback, useEffect, useMemo, useState} from 'react';
import {ArrowTopRightOnSquareIcon, CheckCircleIcon, LockClosedIcon} from '@heroicons/react/24/outline';
import {callFunctionPublic} from '../utils/callableRequest.js';

const EMPTY_PROFILE = {
  legalName: '', businessAddress: '', city: '', postalCode: '', telephone: '',
  signerName: '', signerTitle: '', taxNumber: '',
};

function Step({number, title, complete, active}) {
  return (
    <div className={`rounded-xl border p-3 ${complete ? 'border-emerald-200 bg-emerald-50' : active ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-emerald-600 text-white' : active ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {complete ? '✓' : number}
        </span>
        <span className="text-sm font-semibold text-slate-800">{title}</span>
      </div>
    </div>
  );
}

export default function RegionalPartnerOnboardingPage({token, previewMode = false}) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [signature, setSignature] = useState({
    signerName: '', signerTitle: '', code: '', reviewedDocument: false,
    consentElectronic: false, intentToSign: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const loadStatus = useCallback(async () => {
    if (previewMode) {
      const previewPartnerType = new URLSearchParams(window.location.search)
        .get('partnerType') === 'individual' ? 'individual' : 'company';
      const previewProfile = previewPartnerType === 'individual' ?
        {...EMPTY_PROFILE, legalName: 'Alex Partner', businessAddress: '101 Jasper Avenue', city: 'Edmonton', postalCode: 'T5J 1N9', telephone: '+1 780-555-0100', signerName: 'Alex Partner', signerTitle: 'Individual'} :
        {...EMPTY_PROFILE, legalName: 'Maple Venue Partners Inc.', businessAddress: '101 Jasper Avenue', city: 'Edmonton', postalCode: 'T5J 1N9', telephone: '+1 780-555-0100', signerName: 'Alex Partner', signerTitle: 'President'};
      setStatus({
        status: 'awaiting_signature', contactName: 'Alex Partner', contactEmailMasked: 'al**@example.ca',
        clientId: 'AB-NORTH', province: 'AB', territory: 'Edmonton and Northern Alberta',
        partnerType: previewPartnerType,
        contractingEntity: 'Chargerent Inc', currency: 'CAD', commissionPoolPercent: 40,
        testMode: true,
        profile: previewProfile,
        agreement: {status: 'awaiting_signature', title: 'Chargerent Inc Canadian Regional Representative Agreement', agreementUrl: '#'},
        activation: {status: 'not_ready'},
      });
      setProfile(previewProfile);
      setSignature((previous) => ({
        ...previous,
        signerName: previewProfile.signerName,
        signerTitle: previewProfile.signerTitle,
      }));
      setLoading(false);
      return;
    }
    try {
      const result = await callFunctionPublic('partnerOnboarding_status', {token});
      setStatus(result);
      setProfile({...EMPTY_PROFILE, ...(result?.profile || {})});
      setSignature((previous) => ({
        ...previous,
        signerName: result?.profile?.signerName || previous.signerName,
        signerTitle: result?.profile?.signerTitle || previous.signerTitle,
      }));
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'This onboarding link could not be opened.'});
    } finally {
      setLoading(false);
    }
  }, [previewMode, token]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const progress = useMemo(() => ({
    profile: Boolean(status?.profile?.legalName),
    agreement: status?.agreement?.status === 'signed',
    active: status?.activation?.status === 'active',
  }), [status]);
  const isIndividual = status?.partnerType === 'individual';
  const profileFields = isIndividual ? [
    ['legalName', 'Full legal name'], ['telephone', 'Telephone'],
    ['businessAddress', 'Mailing address'], ['city', 'City'],
    ['postalCode', 'Postal code'], ['taxNumber', 'GST/HST/QST number (if registered)'],
  ] : [
    ['legalName', 'Legal company name'], ['telephone', 'Business telephone'],
    ['businessAddress', 'Business address'], ['city', 'City'],
    ['postalCode', 'Postal code'], ['taxNumber', 'GST/HST/QST number (if applicable)'],
    ['signerName', 'Authorized signer legal name'], ['signerTitle', 'Authorized signer title'],
  ];

  const submitProfile = async (event) => {
    event.preventDefault();
    if (busy || previewMode) return;
    setBusy('profile'); setMessage(null);
    try {
      const result = await callFunctionPublic('partnerOnboarding_submitProfile', {token, ...profile});
      setStatus(result);
      setSignature((previous) => ({
        ...previous,
        signerName: result?.profile?.signerName || previous.signerName,
        signerTitle: result?.profile?.signerTitle || previous.signerTitle,
      }));
      setMessage({type: 'success', text: 'Your profile was saved and your agreement is ready to review.'});
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'Your profile could not be saved.'});
    } finally { setBusy(''); }
  };

  const requestCode = async () => {
    if (busy || previewMode) return;
    setBusy('code'); setMessage(null);
    try {
      const result = await callFunctionPublic('partnerOnboarding_requestAgreementCode', {token});
      setMessage({type: 'success', text: `A six-digit code was sent to ${result?.emailMasked || 'your email'}.`});
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The verification code could not be sent.'});
    } finally { setBusy(''); }
  };

  const signAgreement = async () => {
    if (busy || previewMode) return;
    setBusy('sign'); setMessage(null);
    try {
      const result = await callFunctionPublic('partnerOnboarding_signAgreement', {token, ...signature});
      setStatus(result);
      setMessage({type: 'success', text: 'Your agreement was signed. A Chargerent administrator will review and activate your dashboard access.'});
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The agreement could not be signed.'});
    } finally { setBusy(''); }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">Opening your secure invitation…</div>;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600">Chargerent Inc</p>
            <h1 className="text-xl font-bold text-slate-900">Canadian Regional Partner Onboarding</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500"><LockClosedIcon className="h-4 w-4" /> Secure invitation</div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {message && <div className={`mb-5 rounded-xl border p-4 text-sm ${message.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{message.text}</div>}
        {!status ? (
          <section className="rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"><h2 className="text-lg font-bold text-slate-900">Invitation unavailable</h2><p className="mt-2 text-sm text-slate-600">{message?.text || 'Ask Chargerent for a new onboarding link.'}</p></section>
        ) : (
          <>
            {status.testMode && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Test onboarding: this invitation is for internal workflow testing and does not activate a production partner account.</div>}
            <section className="rounded-2xl bg-slate-900 p-6 text-white shadow-sm">
              <p className="text-sm text-violet-200">Welcome, {status.contactName}</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                <div><h2 className="text-2xl font-bold">{status.territory}</h2><p className="mt-1 text-sm text-slate-300">Partner ID {status.clientId} · {isIndividual ? 'Individual' : 'Company'} · {status.currency}</p></div>
                <div className="rounded-xl bg-white/10 px-4 py-3 text-right"><p className="text-xs uppercase tracking-wide text-slate-300">Revenue-share pool</p><p className="text-2xl font-bold">{status.commissionPoolPercent}%</p></div>
              </div>
            </section>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <Step number="1" title="Partner profile" complete={progress.profile} active={!progress.profile} />
              <Step number="2" title="Agreement" complete={progress.agreement} active={progress.profile && !progress.agreement} />
              <Step number="3" title="Dashboard" complete={progress.active} active={progress.agreement && !progress.active} />
            </div>

            {!progress.profile && (
              <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">{isIndividual ? 'Individual partner information' : 'Company and signer information'}</h2>
                <p className="mt-1 text-sm text-slate-500">This information will be frozen into your agreement.{isIndividual ? ' You will sign the agreement for yourself.' : ''}</p>
                <form onSubmit={submitProfile} className="mt-5 grid gap-4 sm:grid-cols-2">
                  {profileFields.map(([key, label]) => (
                    <label key={key} className={key === 'businessAddress' ? 'sm:col-span-2' : ''}>
                      <span className="text-sm font-semibold text-slate-700">{label}{key !== 'taxNumber' && <span className="text-rose-500"> *</span>}</span>
                      <input required={key !== 'taxNumber'} value={profile[key] || ''} onChange={(e) => setProfile((previous) => ({...previous, [key]: e.target.value}))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                    </label>
                  ))}
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 sm:col-span-2">Province: {status.province} · Country: Canada · Contact: {status.contactEmailMasked}</div>
                  <button disabled={Boolean(busy) || previewMode} className="rounded-xl bg-violet-600 px-5 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{busy === 'profile' ? 'Preparing agreement…' : 'Save and prepare agreement'}</button>
                </form>
              </section>
            )}

            {progress.profile && !progress.agreement && (
              <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">Review and sign your agreement</h2>
                <p className="mt-1 text-sm text-slate-500">Partner type: {isIndividual ? 'Individual' : 'Company or organization'} · Contracting entity: Chargerent Inc · Ontario law · Canadian dollars</p>
                <a href={status.agreement?.agreementUrl || '#'} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-800">Open complete agreement PDF <ArrowTopRightOnSquareIcon className="h-4 w-4" /></a>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label><span className="text-sm font-semibold text-slate-700">{isIndividual ? 'Your full legal name' : 'Signer legal name'}</span><input value={signature.signerName} onChange={(e) => setSignature((p) => ({...p, signerName: e.target.value}))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  {isIndividual ? (
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-700">Signing capacity</p><p className="mt-1 text-sm text-slate-600">Individual regional partner</p></div>
                  ) : (
                    <label><span className="text-sm font-semibold text-slate-700">Signer title</span><input value={signature.signerTitle} onChange={(e) => setSignature((p) => ({...p, signerTitle: e.target.value}))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  )}
                  <div className="sm:col-span-2 flex flex-wrap gap-2"><button type="button" onClick={requestCode} disabled={Boolean(busy) || previewMode} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">{busy === 'code' ? 'Sending…' : 'Email verification code'}</button><input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={signature.code} onChange={(e) => setSignature((p) => ({...p, code: e.target.value.replace(/\D/g, '')}))} className="w-40 rounded-lg border border-slate-300 px-3 py-2" /></div>
                  <div className="space-y-3 sm:col-span-2">
                    {[
                      ['reviewedDocument', 'I reviewed the complete agreement PDF.'],
                      ['consentElectronic', 'I consent to receive records and sign electronically.'],
                      ['intentToSign', 'I adopt my typed name as my signature and intend to be legally bound.'],
                    ].map(([key, label]) => <label key={key} className="flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={signature[key]} onChange={(e) => setSignature((p) => ({...p, [key]: e.target.checked}))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600" />{label}</label>)}
                  </div>
                  <button type="button" onClick={signAgreement} disabled={Boolean(busy) || previewMode} className="rounded-xl bg-violet-600 px-5 py-3 font-bold text-white disabled:opacity-50 sm:col-span-2">{busy === 'sign' ? 'Signing…' : 'Sign agreement'}</button>
                </div>
              </section>
            )}

            {progress.agreement && !progress.active && (
              <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm"><CheckCircleIcon className="mx-auto h-10 w-10 text-emerald-600" /><h2 className="mt-3 text-lg font-bold text-emerald-900">Onboarding complete</h2><p className="mt-2 text-sm text-emerald-800">Your signed agreement is ready for review. A Chargerent administrator will approve your account and email your password-setup link.</p></section>
            )}

            {progress.active && (
              <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm"><CheckCircleIcon className="mx-auto h-10 w-10 text-emerald-600" /><h2 className="mt-3 text-lg font-bold text-emerald-900">Your dashboard is active</h2><p className="mt-2 text-sm text-emerald-800">Check your email for the secure password-setup link, then sign in to the Chargerent dashboard.</p><a href="/portal/" className="mt-4 inline-block rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white">Open Chargerent dashboard</a></section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
