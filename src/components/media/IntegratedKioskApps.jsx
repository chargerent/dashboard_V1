import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ComputerDesktopIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';

import { callFunctionWithAuth } from '../../utils/callableRequest.js';
import {
  formatPhoneRelativeTime,
  getPhoneConnectionState,
  getPhoneStationCountryCode,
  isIntegratedKiosk,
  normalizePhoneDevice,
} from '../../utils/phoneControl.js';

const KIOSK_MARKETS = [
  { code: 'US', label: 'US' },
  { code: 'CA', label: 'Canada' },
  { code: 'FR', label: 'France' },
];

function stationIdOf(kiosk) {
  return String(kiosk?.stationid || kiosk?.stationId || '').trim().toUpperCase();
}

function stationLabel(kiosk) {
  return [stationIdOf(kiosk), kiosk?.info?.location || kiosk?.info?.place || kiosk?.info?.client]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' — ');
}

function connectionPill(device, now) {
  const online = getPhoneConnectionState(device, now) === 'online';
  return {
    label: online ? 'Online' : 'Offline',
    className: online
      ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200',
  };
}

function stripeReaderLabel(device, stationId = device?.stationId) {
  const reported = device?.inventory?.m2Terminal || {};
  const readerType = reported.readerType || device?.terminal?.stripeReaderType || '';
  if (reported.readerName) return reported.readerName;
  if (readerType === 'bbpos_wisepad3' || /^(FR|CA)/.test(String(stationId || ''))) return 'WisePad 3';
  if (readerType === 'stripe_m2' || String(stationId || '').startsWith('US')) return 'Stripe M2';
  return 'Stripe reader';
}

function terminalSummary(device) {
  const reported = device?.inventory?.m2Terminal || {};
  const reader = stripeReaderLabel(device);
  if (reported.configured && reported.stationId === device.stationId) {
    return reported.connectedReaderSerial
      ? `${reader} ready · ${reported.connectedReaderSerial}`
      : `${reader} configured · not connected`;
  }
  if (device?.terminal?.enabled) {
    return `${reader} ${device.terminal.state || 'provisioning'}`;
  }
  return `${reader} not provisioned`;
}

function KioskAppCard({
  device,
  kiosks,
  occupiedStationIds,
  now,
  canUseLivePayments,
  onRefresh,
  onStatus,
}) {
  const [stationId, setStationId] = useState(device.stationId || '');
  const [terminalEnabled, setTerminalEnabled] = useState(device.terminal?.enabled === true);
  const [stripeMode, setStripeMode] = useState(device.terminal?.stripeMode === 'live' ? 'live' : 'test');
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStationId(device.stationId || '');
    setTerminalEnabled(device.terminal?.enabled === true);
    setStripeMode(device.terminal?.stripeMode === 'live' ? 'live' : 'test');
    setLiveConfirmed(false);
  }, [device.id, device.stationId, device.terminal?.enabled, device.terminal?.stripeMode]);

  const connection = connectionPill(device, now);
  const appVersion = String(device.inventory?.agentVersion || '').trim() || 'Unknown version';
  const model = [device.inventory?.manufacturer, device.inventory?.model]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ') || device.displayName || 'Android kiosk';
  const liveEligible = canUseLivePayments && getPhoneStationCountryCode(stationId) === 'FR';
  const savedStripeMode = device.terminal?.stripeMode === 'live' ? 'live' : 'test';
  const assignmentChanged = Boolean(stationId) && (
    stationId !== device.stationId || terminalEnabled !== (device.terminal?.enabled === true) ||
    (terminalEnabled && stripeMode !== savedStripeMode)
  );

  const saveAssignment = async () => {
    if (!stationId || !assignmentChanged || saving || (stripeMode === 'live' && !liveConfirmed)) return;
    setSaving(true);
    onStatus({
      state: 'sending',
      message: `Saving ${stationId} assignment and Stripe reader settings…`,
    });
    try {
      const result = await callFunctionWithAuth('phoneControl_assignDevice', {
        deviceId: device.id,
        stationId,
        terminalEnabled,
        stripeMode,
      });
      onStatus({
        state: 'success',
        message: result?.message || `${stationId} is assigned to the integrated kiosk app.`,
      });
      await onRefresh(false);
    } catch (error) {
      onStatus({
        state: 'error',
        message: error?.message || 'The Android kiosk assignment could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-integrated-kiosk-device={device.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">{device.stationId || device.displayName || 'Unassigned kiosk app'}</h3>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ring-1 ring-inset ${connection.className}`}>
              {connection.label}
            </span>
            {!device.stationId && (
              <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200">
                Unassigned
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">{model} · {appVersion} · {formatPhoneRelativeTime(device.lastSeenAtMs, now)}</p>
          <p className="mt-1 font-mono text-[10px] text-slate-400">{device.id}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
          device.inventory?.m2Terminal?.configured && device.inventory.m2Terminal.stationId === device.stationId
            ? 'bg-violet-100 text-violet-800'
            : 'bg-slate-100 text-slate-600'
        }`}>
          {terminalSummary(device)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
        <label className="block min-w-0">
          <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Assigned station</span>
          <select
            value={stationId}
            onChange={(event) => {
              const nextStationId = event.target.value;
              const nextKiosk = kiosks.find((kiosk) => stationIdOf(kiosk) === nextStationId);
              setStationId(nextStationId);
              setStripeMode(nextKiosk?.paymentTerminal?.stripeMode === 'live' ? 'live' : 'test');
              setLiveConfirmed(false);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">Select a station</option>
            {kiosks.map((kiosk) => {
              const candidateStationId = stationIdOf(kiosk);
              const occupied = occupiedStationIds.has(candidateStationId) && candidateStationId !== device.stationId;
              return (
                <option key={candidateStationId} value={candidateStationId} disabled={occupied}>
                  {stationLabel(kiosk)}{occupied ? ' · Already assigned' : ''}
                </option>
              );
            })}
          </select>
        </label>

        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900">
          <input
            type="checkbox"
            checked={terminalEnabled}
            onChange={(event) => setTerminalEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
          />
          Provision {stripeReaderLabel(device, stationId)}
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Stripe mode</span>
          <select
            value={stripeMode}
            disabled={!terminalEnabled}
            onChange={(event) => {
              setStripeMode(event.target.value === 'live' ? 'live' : 'test');
              setLiveConfirmed(false);
            }}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="test">Test — no real charge</option>
            <option value="live" disabled={!liveEligible}>Live — real charges</option>
          </select>
        </label>

        <button
          type="button"
          onClick={saveAssignment}
          disabled={!assignmentChanged || saving || (stripeMode === 'live' && !liveConfirmed)}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save assignment'}
        </button>
      </div>
      {terminalEnabled && stripeMode === 'live' && (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-900">
          <input
            type="checkbox"
            checked={liveConfirmed}
            onChange={(event) => setLiveConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500"
          />
          I understand that {stationId} will use the French live Stripe account and real cards can be charged.
        </label>
      )}
    </article>
  );
}

export default function IntegratedKioskApps({
  currentUser,
  kiosks,
  referenceTime,
  onStatus,
}) {
  const [allDevices, setAllDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => Number(referenceTime || Date.now()));
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [enrollmentMode, setEnrollmentMode] = useState('assigned');
  const [enrollmentMarket, setEnrollmentMarket] = useState('US');
  const [enrollmentStationId, setEnrollmentStationId] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const [creatingEnrollment, setCreatingEnrollment] = useState(false);

  const isAdmin = currentUser?.isAdmin === true || currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const hasDeviceAccess = isAdmin || currentUser?.features?.phone_control === true;

  const loadDevices = useCallback(async (showSpinner = false) => {
    if (!hasDeviceAccess) {
      setAllDevices([]);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const response = await callFunctionWithAuth('phoneControl_listDevices');
      setAllDevices((Array.isArray(response?.devices) ? response.devices : [])
        .map((device) => normalizePhoneDevice(device, device?.id || device?.deviceId))
        .filter((device) => device.id)
        .sort((left, right) => (
          (left.stationId || 'ZZZZ').localeCompare(right.stationId || 'ZZZZ') || left.id.localeCompare(right.id)
        )));
      setLoadError('');
    } catch (error) {
      setLoadError(error?.message || 'Unable to load the live Android kiosk inventory.');
    } finally {
      setLoading(false);
    }
  }, [hasDeviceAccess]);

  useEffect(() => {
    loadDevices(true);
    const refreshInterval = window.setInterval(() => loadDevices(false), 15_000);
    const clockInterval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);
    };
  }, [loadDevices]);

  const normalizedKiosks = useMemo(() => [...kiosks]
    .filter((kiosk) => stationIdOf(kiosk))
    .sort((left, right) => stationIdOf(left).localeCompare(stationIdOf(right))), [kiosks]);
  const integratedDevices = useMemo(() => allDevices.filter(isIntegratedKiosk), [allDevices]);
  const occupiedStationIds = useMemo(() => new Set(
    allDevices.map((device) => device.stationId).filter(Boolean),
  ), [allDevices]);
  const availableEnrollmentKiosks = useMemo(() => normalizedKiosks.filter((kiosk) => {
    const stationId = stationIdOf(kiosk);
    return getPhoneStationCountryCode(stationId) === enrollmentMarket && !occupiedStationIds.has(stationId);
  }), [enrollmentMarket, normalizedKiosks, occupiedStationIds]);

  useEffect(() => {
    if (enrollmentMode !== 'assigned') return;
    if (!availableEnrollmentKiosks.some((kiosk) => stationIdOf(kiosk) === enrollmentStationId)) {
      setEnrollmentStationId(availableEnrollmentKiosks[0] ? stationIdOf(availableEnrollmentKiosks[0]) : '');
    }
  }, [availableEnrollmentKiosks, enrollmentMode, enrollmentStationId]);

  const createEnrollment = async () => {
    if (creatingEnrollment || (enrollmentMode === 'assigned' && !enrollmentStationId)) return;
    setCreatingEnrollment(true);
    setEnrollment(null);
    onStatus({ state: 'sending', message: 'Creating a production kiosk enrollment code…' });
    try {
      const result = await callFunctionWithAuth('phoneControl_createEnrollment', {
        market: enrollmentMarket,
        deviceKind: 'integrated_kiosk',
        stationId: enrollmentMode === 'assigned' ? enrollmentStationId : '',
      });
      setEnrollment(result);
      onStatus({ state: 'success', message: result?.message || 'Kiosk enrollment code created.' });
    } catch (error) {
      onStatus({ state: 'error', message: error?.message || 'Could not create the kiosk enrollment code.' });
    } finally {
      setCreatingEnrollment(false);
    }
  };

  if (!hasDeviceAccess) return null;

  return (
    <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-white via-white to-violet-50 p-5 shadow-md" data-live-android-apps="true">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
            <ComputerDesktopIcon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">Production fleet</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Live Android kiosk apps</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Enroll the integrated media and Stripe app, assign it to a station, and provision its regional Stripe reader. France and Canada use WisePad 3; US kiosks use Stripe M2.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadDevices(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setShowEnrollment((current) => !current);
              setEnrollment(null);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700"
          >
            <PlusIcon className="h-4 w-4" />
            Enroll kiosk app
          </button>
        </div>
      </div>

      {showEnrollment && (
        <div className="mt-5 rounded-xl border border-violet-200 bg-white p-4">
          <div className="grid gap-3 lg:grid-cols-[auto_auto_minmax(14rem,1fr)_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Enrollment</span>
              <select
                value={enrollmentMode}
                onChange={(event) => {
                  setEnrollmentMode(event.target.value === 'unassigned' ? 'unassigned' : 'assigned');
                  setEnrollment(null);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="assigned">Assign during enrollment</option>
                <option value="unassigned">Prepare now, assign later</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Market</span>
              <select
                value={enrollmentMarket}
                onChange={(event) => {
                  setEnrollmentMarket(event.target.value);
                  setEnrollmentStationId('');
                  setEnrollment(null);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {KIOSK_MARKETS.map((market) => <option key={market.code} value={market.code}>{market.label}</option>)}
              </select>
            </label>
            {enrollmentMode === 'assigned' ? (
              <label className="block min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Station</span>
                <select
                  value={enrollmentStationId}
                  onChange={(event) => {
                    setEnrollmentStationId(event.target.value);
                    setEnrollment(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select an available station</option>
                  {availableEnrollmentKiosks.map((kiosk) => (
                    <option key={stationIdOf(kiosk)} value={stationIdOf(kiosk)}>{stationLabel(kiosk)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
                The app will stay in unassigned {enrollmentMarket} inventory until you select a station below.
              </div>
            )}
            <button
              type="button"
              onClick={createEnrollment}
              disabled={creatingEnrollment || (enrollmentMode === 'assigned' && !enrollmentStationId)}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creatingEnrollment ? 'Creating…' : 'Create kiosk code'}
            </button>
          </div>
          {enrollment?.enrollmentCode && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">Enter this six-digit code once on the kiosk enrollment screen</p>
              <p className="mt-1 font-mono text-3xl font-black tracking-[0.22em] text-blue-950">{enrollment.enrollmentCode}</p>
              <p className="mt-1 text-xs text-blue-700">{enrollment.stationId || `${enrollment.market} unassigned inventory`} · expires in 15 minutes</p>
            </div>
          )}
        </div>
      )}

      {loadError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{loadError}</p>
      )}

      <div className="mt-5 space-y-3">
        {loading && integratedDevices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Loading live kiosk apps…</div>
        ) : integratedDevices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-sm font-bold text-slate-700">No integrated kiosk apps are enrolled yet.</p>
            <p className="mt-1 text-xs text-slate-500">Install the approved kiosk APK, create a code here, then enter it on the app’s first screen.</p>
          </div>
        ) : integratedDevices.map((device) => (
          <KioskAppCard
            key={device.id}
            device={device}
            kiosks={normalizedKiosks}
            occupiedStationIds={occupiedStationIds}
            now={now}
            canUseLivePayments={isAdmin}
            onRefresh={loadDevices}
            onStatus={onStatus}
          />
        ))}
      </div>
    </section>
  );
}
