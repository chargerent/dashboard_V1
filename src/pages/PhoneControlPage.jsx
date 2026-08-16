import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  Battery100Icon,
  BoltIcon,
  CreditCardIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LockClosedIcon,
  LockOpenIcon,
  MapPinIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  SignalIcon,
  Squares2X2Icon,
  WifiIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import ModalPortal from '../components/UI/ModalPortal.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { filterStationsForClient } from '../utils/helpers.js';
import {
  HIGH_IMPACT_PHONE_OPERATIONS,
  PHONE_KIOSK_COUNTRIES,
  createPhoneCommandRequestId,
  formatPhoneRelativeTime,
  getKioskForPhone,
  getPhoneKioskCountryCode,
  getPhoneConnectionState,
  isPhoneAgentUpdateAvailable,
  isPhoneWebRtcActive,
  isPhoneRemoteInputAvailable,
  normalizeAgentRelease,
  normalizePaymentAppRelease,
  normalizePhoneDevice,
  phoneLocationMapUrls,
  phoneHotspotLabel,
  phoneMatchesSearch,
  phoneNetworkLabel,
  phoneSignalLevelFromDbm,
  phoneTimestampToMillis,
} from '../utils/phoneControl.js';
import {
  PHONE_WEBRTC_PROFILES,
  createWebRtcSessionId,
  encodeGlobalActionPacket,
  encodePointerPacket,
  mediaPoint,
  normalizePhoneWebRtcIceServers,
  waitForIceGatheringComplete,
} from '../utils/phoneWebRtc.js';

const FILTERS = [
  { value: 'all', label: 'All phones' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'unassigned', label: 'Unassigned' },
];

const TERMINAL_AGENT_MIN_VERSION_CODE = 29;

const STATE_STYLES = {
  online: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Online' },
  offline: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', label: 'Offline' },
  never: { dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600', label: 'Not connected' },
};

const COMMAND_STYLES = {
  queued: 'bg-amber-100 text-amber-700',
  delivered: 'bg-blue-100 text-blue-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-slate-100 text-slate-600',
};

const TERMINAL_STYLES = {
  ready: { badge: 'bg-emerald-100 text-emerald-700', label: 'Terminal ready' },
  provisioning: { badge: 'bg-blue-100 text-blue-700', label: 'Terminal provisioning' },
  error: { badge: 'bg-red-100 text-red-700', label: 'Terminal error' },
  pending: { badge: 'bg-amber-100 text-amber-700', label: 'Terminal pending' },
  disabled: { badge: 'bg-slate-100 text-slate-600', label: 'Phone only' },
};

const CONFIRMATION_REQUIRED_PHONE_OPERATIONS = new Set([
  ...HIGH_IMPACT_PHONE_OPERATIONS,
  'SET_WIFI_ENABLED',
  'SET_HOTSPOT_ENABLED',
  'SET_ALWAYS_ON_HOTSPOT',
]);

const PHONE_COMMAND_LABELS = {
  PING: 'Ping phone',
  GET_INVENTORY: 'Refresh device details',
  GET_LOCATION: 'Refresh location',
  SET_LOCATION_ENABLED: 'GPS',
  SET_WIFI_ENABLED: 'Wi-Fi',
  SET_HOTSPOT_ENABLED: 'Hotspot',
  SCAN_WIFI_NETWORKS: 'Scan Wi-Fi networks',
  CONNECT_WIFI: 'Join Wi-Fi network',
  OPEN_CAPTIVE_PORTAL: 'Open Wi-Fi sign-in',
  SET_ALWAYS_ON_HOTSPOT: 'Always-on hotspot',
  OPEN_TETHER_SETTINGS: 'Open tethering settings',
  SET_BLUETOOTH_ENABLED: 'Bluetooth',
  LOCK_NOW: 'Lock phone',
  WAKE_AND_UNLOCK: 'Wake and unlock',
  REBOOT: 'Reboot phone',
  POWER_OFF: 'Shut down phone',
  SET_UPDATE_POLICY: 'Update policy',
  SET_SCREEN_BRIGHTNESS: 'Screen brightness',
  SET_SCREEN_TIMEOUT: 'Screen timeout',
  SET_AUTOMATIC_TIME: 'Automatic time',
  SET_TIME_ZONE: 'Time zone',
  SET_KEYGUARD_DISABLED: 'Lock screen',
  SET_KIOSK_ALLOWLIST: 'Kiosk apps',
  SET_TERMINAL_LOCKDOWN: 'Payment app lockdown',
  LAUNCH_PAYMENT_APP: 'Launch payment app',
  SET_APP_HIDDEN: 'App visibility',
  SET_APP_SUSPENDED: 'App suspension',
  SET_RUNTIME_PERMISSION: 'App permission',
  REQUEST_BUGREPORT: 'Request bug report',
  SET_NETWORK_LOGGING: 'Network logging',
  SET_SECURITY_LOGGING: 'Security logging',
  UI_TAP: 'Screen tap',
  UI_SWIPE: 'Screen swipe',
  UI_GLOBAL_ACTION: 'Phone navigation',
  UI_SET_FOCUSED_TEXT: 'Enter text',
  CAPTURE_SCREEN: 'Capture screen',
  START_LIVE_SCREEN: 'Start fallback preview',
  STOP_LIVE_SCREEN: 'Stop fallback preview',
  START_WEBRTC_SCREEN: 'Start live screen',
  SET_WEBRTC_PROFILE: 'Live screen quality',
  STOP_WEBRTC_SCREEN: 'Stop live screen',
  INSTALL_SYSTEM_UPDATE: 'Install system update',
  INSTALL_APP_UPDATE: 'Install app update',
  INSTALL_PAYMENT_APP: 'Update payment app',
  WIPE_DEVICE: 'Erase phone',
};

function stationIdOf(kiosk) {
  return String(kiosk?.stationid || kiosk?.stationId || '').trim().toUpperCase();
}

function commandTimestamp(command) {
  return phoneTimestampToMillis(command?.updatedAt || command?.completedAt || command?.createdAt || command?.issuedAt);
}

function commandLabel(operation) {
  const normalizedOperation = String(operation || 'command').trim().toUpperCase();
  if (PHONE_COMMAND_LABELS[normalizedOperation]) return PHONE_COMMAND_LABELS[normalizedOperation];
  return normalizedOperation
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function commandActionLabel(operation, args = {}) {
  if (operation === 'SET_WIFI_ENABLED') return `Turn Wi-Fi ${args.enabled === true ? 'on' : 'off'}`;
  if (operation === 'SET_LOCATION_ENABLED') return `Turn GPS ${args.enabled === true ? 'on' : 'off'}`;
  if (operation === 'SCAN_WIFI_NETWORKS') return 'Scan nearby Wi-Fi networks';
  if (operation === 'CONNECT_WIFI') return `Join ${args.ssid || 'Wi-Fi network'}`;
  if (operation === 'OPEN_CAPTIVE_PORTAL') return 'Open public Wi-Fi sign-in';
  if (operation === 'SET_HOTSPOT_ENABLED') return `Turn hotspot ${args.enabled === true ? 'on' : 'off'}`;
  if (operation === 'SET_ALWAYS_ON_HOTSPOT') return `${args.enabled === true ? 'Enable' : 'Disable'} always-on hotspot`;
  if (operation === 'SET_TERMINAL_LOCKDOWN') return `${args.enabled === true ? 'Lock' : 'Unlock'} payment app`;
  if (operation === 'LAUNCH_PAYMENT_APP') return 'Launch payment app';
  if (operation === 'POWER_OFF') return 'Shut down phone';
  if (operation === 'INSTALL_APP_UPDATE' && args.versionName) return `Install Agent ${args.versionName}`;
  if (operation === 'INSTALL_PAYMENT_APP' && args.versionName) return `Install payment app ${args.versionName}`;
  return commandLabel(operation);
}

function humanizePhoneMessage(message) {
  return String(message || '').replace(
    /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
    (operation) => commandLabel(operation),
  );
}

function phoneCommandConfirmationDetails(confirmation, device) {
  const operation = confirmation?.operation;
  const stationLabel = device?.stationId || device?.displayName || 'this device';

  if (operation === 'REBOOT') {
    return {
      title: 'Confirm Reboot',
      action: operation,
      confirmationText: `Reboot the phone assigned to ${stationLabel}? It will be unreachable while restarting.`,
    };
  }

  if (operation === 'POWER_OFF') {
    return {
      title: 'Confirm Phone Shutdown',
      action: operation,
      confirmationText: `Shut down the phone assigned to ${stationLabel}? It will remain offline and cannot be turned back on remotely; someone must press its physical power button.`,
    };
  }

  if (operation === 'SET_WIFI_ENABLED') {
    const enabling = confirmation?.args?.enabled === true;
    return {
      title: `Confirm Wi-Fi ${enabling ? 'On' : 'Off'}`,
      action: operation,
      confirmationText: enabling
        ? `Turn Wi-Fi on for the phone assigned to ${stationLabel}? It will attempt to reconnect to a saved network.`
        : `Turn Wi-Fi off for the phone assigned to ${stationLabel}? It may become unreachable if Wi-Fi is its only network connection.`,
    };
  }

  if (operation === 'SET_ALWAYS_ON_HOTSPOT') {
    const enabling = confirmation?.args?.enabled === true;
    return {
      title: `${enabling ? 'Enable' : 'Disable'} Always-on Hotspot`,
      action: operation,
      confirmationText: enabling
        ? `Keep hotspot on for the phone assigned to ${stationLabel}? Agent will start it and restore it after shutdowns or reboots.`
        : `Disable always-on hotspot for the phone assigned to ${stationLabel}? Devices using that hotspot may lose their network connection.`,
    };
  }

  if (operation === 'SET_HOTSPOT_ENABLED') {
    const enabling = confirmation?.args?.enabled === true;
    const disablesAlwaysOn = !enabling && device?.inventory?.hotspotAlwaysOn;
    return {
      title: `Confirm Hotspot ${enabling ? 'On' : 'Off'}`,
      action: operation,
      confirmationText: enabling
        ? `Turn hotspot on for the phone assigned to ${stationLabel}? This starts it now without enabling automatic recovery.`
        : `Turn hotspot off for the phone assigned to ${stationLabel}? Connected devices will lose access${disablesAlwaysOn ? ' and Always-on will also be disabled' : ''}.`,
    };
  }

  if (operation === 'INSTALL_APP_UPDATE') {
    const versionName = confirmation?.args?.versionName || 'update';
    return {
      title: `Install Agent ${versionName}`,
      action: operation,
      confirmationText: `Install Agent ${versionName} on the phone assigned to ${stationLabel}? Remote management will restart briefly while Android replaces the app.`,
    };
  }

  if (operation === 'INSTALL_PAYMENT_APP') {
    const versionName = confirmation?.args?.versionName || 'update';
    return {
      title: `Update Payment App ${versionName}`,
      action: operation,
      confirmationText: `Install payment app ${versionName} on the terminal assigned to ${stationLabel}? The customer screen will restart briefly and return to lockdown.`,
    };
  }

  return {
    title: `Confirm ${commandLabel(operation)}`,
    action: operation,
    confirmationText: `${commandLabel(operation)} is a high-impact phone operation. Continue?`,
  };
}

function SummaryCard({ label, value, detail, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
    </div>
  );
}

function AddPhoneCard({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-dashed border-blue-300 bg-blue-50/70 p-4 text-left text-blue-900 shadow-sm transition hover:border-blue-400 hover:bg-blue-100/70 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-500/15"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Add a phone</p>
      <PlusIcon className="mt-1 h-8 w-8 stroke-2 text-blue-600 transition group-hover:scale-105" />
      <p className="mt-1 text-xs text-blue-700/75">Provision or enroll a kiosk phone</p>
    </button>
  );
}

function FieldProvisioningCard() {
  const basePath = import.meta.env.BASE_URL || '/portal/';
  const [release, setRelease] = useState({
    versionCode: 25,
    versionName: '1.2.10',
    apkUrl: 'https://chargerentstations.com/portal/mdm/remote-agent-v1.2.10.apk',
    qrImagePath: `${basePath}mdm/remote-agent-device-owner-qr.png`,
    qrPayloadPath: `${basePath}mdm/remote-agent-device-owner-payload.json`,
  });

  useEffect(() => {
    let active = true;
    fetch(`${basePath}mdm/remote-agent-provisioning.json`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Field provisioning metadata is unavailable');
        return response.json();
      })
      .then((metadata) => {
        const trustedRelease = normalizeAgentRelease(metadata);
        if (active) setRelease((current) => ({ ...current, ...metadata, ...trustedRelease }));
      })
      .catch(() => {
        // The bundled release details remain usable when metadata refresh is unavailable.
      });
    return () => {
      active = false;
    };
  }, [basePath]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">Factory setup QR</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Reusable Device Owner setup for factory-reset Android phones.</p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">Agent {release.versionName}</span>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
        <img
          src={release.qrImagePath}
          alt="Agent Android Device Owner provisioning QR code"
          className="mx-auto aspect-square w-full max-w-[220px] rounded-lg bg-white"
        />
      </div>

      <ol className="mt-4 space-y-2 text-xs leading-5 text-slate-600">
        <li><span className="font-bold text-slate-800">1.</span> Factory-reset the phone and stop at the first Welcome screen.</li>
        <li><span className="font-bold text-slate-800">2.</span> Tap the same empty area six times, then connect to Wi-Fi.</li>
        <li><span className="font-bold text-slate-800">3.</span> Scan this QR and wait for Android to install Agent.</li>
        <li><span className="font-bold text-slate-800">4.</span> Enter the one-time kiosk code created below.</li>
        <li><span className="font-bold text-slate-800">5.</span> Open Agent and approve always-on hotspot access.</li>
      </ol>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={release.qrImagePath} download="remote-agent-device-owner-qr.png" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs font-bold text-blue-700 hover:bg-blue-100">Download QR</a>
        <a href={release.apkUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-bold text-slate-700 hover:bg-slate-50">Download APK</a>
      </div>
      <a href={release.qrPayloadPath} target="_blank" rel="noreferrer" className="mt-3 block text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">View Android provisioning file</a>
    </div>
  );
}

function PhoneEnrollmentModal({
  isOpen,
  onClose,
  enrollmentCountry,
  onEnrollmentCountryChange,
  enrollmentStationId,
  onEnrollmentStationIdChange,
  enrollmentKioskOptions,
  assignedStationIds,
  enrollmentCode,
  onCreateEnrollment,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const closeButton = dialogRef.current?.querySelector('[data-enrollment-close]');
    closeButton?.focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="phone-enrollment-modal-title"
          className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl bg-slate-100 shadow-2xl"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div>
              <h2 id="phone-enrollment-modal-title" className="text-xl font-black text-slate-900">Add a phone</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Provision a factory-reset Android phone, then create its one-time kiosk enrollment code.</p>
            </div>
            <button
              type="button"
              data-enrollment-close
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
              aria-label="Close add phone"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2 lg:items-start">
            <FieldProvisioningCard />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-black text-slate-900">Enroll a kiosk phone</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Create a one-time code tied to a kiosk, then enter it in Agent.</p>
              <div className="mt-3 grid grid-cols-3 rounded-lg bg-slate-100 p-1" role="group" aria-label="Enrollment kiosk country">
                {PHONE_KIOSK_COUNTRIES.map((country) => (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() => onEnrollmentCountryChange(country.code)}
                    aria-pressed={enrollmentCountry === country.code}
                    className={`rounded-md px-2 py-2 text-xs font-bold transition ${enrollmentCountry === country.code ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {country.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <select
                  value={enrollmentStationId}
                  onChange={(event) => onEnrollmentStationIdChange(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select {PHONE_KIOSK_COUNTRIES.find((country) => country.code === enrollmentCountry)?.label} kiosk</option>
                  {enrollmentKioskOptions.map((kiosk) => (
                    <option key={kiosk.stationId} value={kiosk.stationId} disabled={assignedStationIds.has(kiosk.stationId)}>
                      {kiosk.stationId}{kiosk.label ? ` — ${kiosk.label}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onCreateEnrollment}
                  disabled={!enrollmentStationId}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create
                </button>
              </div>
              {enrollmentCode && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">One-time enrollment code</p>
                  <p className="mt-1 font-mono text-2xl font-black tracking-[0.22em] text-blue-900">{enrollmentCode}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

async function fetchCurrentAgentRelease() {
  const basePath = import.meta.env.BASE_URL || '/portal/';
  const response = await fetch(`${basePath}mdm/remote-agent-provisioning.json`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Current Agent release information is unavailable.');
  return normalizeAgentRelease(await response.json());
}

async function fetchCurrentPaymentAppRelease() {
  const basePath = import.meta.env.BASE_URL || '/portal/';
  const response = await fetch(`${basePath}mdm/chargerent-payment-provisioning.json`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Current payment app release information is unavailable.');
  return normalizePaymentAppRelease(await response.json());
}

function Metric({ icon: Icon, label, value, detail = '', detailTone = 'slate', active = null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon className={`h-4 w-4 ${active === false ? 'text-slate-300' : 'text-slate-500'}`} />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-bold text-slate-800">{value}</p>
      {detail && <p className={`mt-0.5 truncate text-[11px] font-semibold ${detailTone === 'red' ? 'text-red-600' : 'text-slate-500'}`}>{detail}</p>}
    </div>
  );
}

function AgentMetric({
  inventory,
  release,
  releaseLoading,
  updateChecking,
  canControl,
  onUpdate,
}) {
  const updateAvailable = isPhoneAgentUpdateAvailable(inventory, release);
  const version = inventory.agentVersion ? `v${inventory.agentVersion}` : 'Unknown';
  const buttonEnabled = updateAvailable && canControl && !releaseLoading && !updateChecking;
  const buttonTitle = releaseLoading
    ? 'Checking the current Agent release'
    : !release
      ? 'The current Agent release is unavailable'
      : !updateAvailable
        ? 'Agent is up to date'
        : !canControl
          ? 'The phone must be online to install the update'
          : `Update to Agent ${release.versionName}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <BoltIcon className="h-4 w-4 text-slate-500" />
        Agent
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
        <p className={`min-w-0 truncate text-sm font-bold ${updateAvailable ? 'text-red-600' : 'text-slate-800'}`}>{version}</p>
        <button
          type="button"
          onClick={onUpdate}
          disabled={!buttonEnabled}
          title={buttonTitle}
          className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${releaseLoading || updateChecking ? 'animate-spin' : ''}`} />
          {releaseLoading || updateChecking ? 'Checking…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

function ActionButton({ children, icon: Icon, onClick, disabled = false, tone = 'slate', title = '', className = '' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
    red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function TerminalControlPanel({
  device,
  terminalStyle,
  locked,
  canControl,
  agentReady,
  paymentUpdateChecking,
  onToggleLockdown,
  onLaunch,
  onReprovision,
  onUpdatePaymentApp,
}) {
  const inventory = device?.inventory || {};
  const terminal = device?.terminal || {};
  const packageVersion = inventory.terminalPackageVersionName
    ? `v${inventory.terminalPackageVersionName}`
    : 'Version not reported';
  const stripeCountry = terminal.stripeAccountCountry || 'Not configured';
  const stripeMode = terminal.stripeMode ? terminal.stripeMode.toUpperCase() : 'UNKNOWN';
  const controlsDisabled = !canControl || !agentReady;

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white shadow-lg">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CreditCardIcon className="h-6 w-6 text-blue-300" />
              <h3 className="text-xl font-black">Payment terminal</h3>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              Dedicated terminal controls replace live screen and Android navigation for this phone.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${terminalStyle.badge}`}>
            {terminalStyle.label}
          </span>
        </div>
      </div>

      <div className="grid gap-3 border-b border-white/10 px-5 py-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Payment app</p>
          <p className="mt-1 text-sm font-black text-white">
            {inventory.terminalPackageInstalled ? 'Installed' : 'Not installed'}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{packageVersion}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Lockdown</p>
          <p className={`mt-1 text-sm font-black ${locked ? 'text-emerald-300' : 'text-amber-300'}`}>
            {locked ? 'Locked for customers' : 'Maintenance access open'}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {inventory.terminalLockdownPermitted ? 'Device Owner permission active' : 'Device Owner permission missing'}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Stripe account</p>
          <p className="mt-1 text-sm font-black text-white">{stripeCountry} · {stripeMode}</p>
          <p className="mt-0.5 text-xs text-slate-400">Derived from the kiosk terminal assignment</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Configuration</p>
          <p className="mt-1 text-sm font-black text-white">{terminal.message || 'Waiting for terminal status'}</p>
          <p className="mt-0.5 text-xs text-slate-400">{device?.stationId || 'Unassigned phone'}</p>
        </div>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <ActionButton
          icon={locked ? LockOpenIcon : LockClosedIcon}
          onClick={onToggleLockdown}
          disabled={controlsDisabled}
          tone={locked ? 'amber' : 'green'}
          className="min-h-14 !text-sm"
        >
          {locked ? 'Unlock to Home' : 'Lock app'}
        </ActionButton>
        <ActionButton
          icon={PlayIcon}
          onClick={onLaunch}
          disabled={controlsDisabled || !inventory.terminalPackageInstalled}
          tone="blue"
          className="min-h-14 !text-sm"
        >
          Launch app
        </ActionButton>
        <ActionButton
          icon={ArrowPathIcon}
          onClick={onReprovision}
          disabled={controlsDisabled || !inventory.commandEncryptionReady}
          tone="slate"
          className="min-h-14 !text-sm"
        >
          Reprovision
        </ActionButton>
        <ActionButton
          icon={BoltIcon}
          onClick={onUpdatePaymentApp}
          disabled={controlsDisabled || paymentUpdateChecking}
          tone="blue"
          className="min-h-14 !text-sm"
        >
          {paymentUpdateChecking ? 'Checking update…' : 'Update payment app'}
        </ActionButton>
      </div>
    </section>
  );
}

function WifiToggle({ enabled, onToggle, disabled = false, className = '', label = 'Wi-Fi', icon: Icon = WifiIcon, compact = false, title = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${label} ${enabled ? 'on' : 'off'}`}
      title={title}
      onClick={onToggle}
      disabled={disabled}
      className={`flex min-h-10 min-w-0 items-center justify-between ${compact ? 'gap-2 px-2' : 'gap-3 px-3'} rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className={`grid shrink-0 grid-cols-2 rounded-lg border border-slate-300 bg-slate-200 p-0.5 ${compact ? 'min-w-[4.75rem]' : 'min-w-[5.5rem]'}`}>
        <span className={`rounded-md ${compact ? 'px-1.5' : 'px-2'} py-1 text-center transition ${enabled ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>
          On
        </span>
        <span className={`rounded-md ${compact ? 'px-1.5' : 'px-2'} py-1 text-center transition ${enabled ? 'text-slate-500' : 'bg-white text-slate-700 shadow-sm'}`}>
          Off
        </span>
      </span>
    </button>
  );
}

function PhoneLocationCard({ device, now, onRefresh, onToggleLocation, locationEnabled, canRefresh }) {
  const location = device?.location || {};
  const mapUrls = phoneLocationMapUrls(location);
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const capturedAtMs = location.capturedAtMs || location.receivedAtMs;
  const accuracy = Number(location.accuracyMeters);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPinIcon className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black text-slate-900">Phone location</h3>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {mapUrls
              ? `${Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m · ` : ''}${capturedAtMs ? formatPhoneRelativeTime(capturedAtMs, now) : 'Current result'}`
              : 'No successful location result yet'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mapUrls && (
            <a href={mapUrls.external} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600 hover:text-blue-800">
              Open map
            </a>
          )}
          <button
            type="button"
            onClick={onToggleLocation}
            disabled={!canRefresh}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MapPinIcon className="h-3.5 w-3.5" />
            {locationEnabled ? 'GPS off' : 'GPS on'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canRefresh}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>
      {mapUrls ? (
        <>
          <iframe
            title={`Location of ${device.stationId || device.id}`}
            src={mapUrls.embed}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-44 w-full border-0 bg-slate-100"
          />
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500">
            <span>{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
            <span>{location.stale ? 'Cached position' : (location.provider || location.source || 'Android location')}</span>
          </div>
        </>
      ) : (
        <div className="flex h-32 items-center justify-center border-t border-slate-100 bg-slate-50 px-6 text-center text-xs leading-5 text-slate-500">
          Select “Refresh” after GPS is enabled. The map appears when Android returns coordinates.
        </div>
      )}
    </section>
  );
}

function NetworkSignalBars({ dbm, type = 'wifi', level, label, active = true }) {
  const dbmLevel = phoneSignalLevelFromDbm(dbm, type);
  const fallbackLevel = Number.isFinite(Number(level))
    ? Math.max(0, Math.min(4, Number(level)))
    : -1;
  const normalizedLevel = active ? (dbmLevel ?? fallbackLevel) : -1;
  return (
    <span className={`inline-flex h-4 items-end gap-0.5 ${active ? '' : 'opacity-60'}`} role="img" aria-label={label}>
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={`w-1 rounded-sm ${normalizedLevel >= bar ? 'bg-emerald-500' : 'bg-slate-200'}`}
          style={{ height: `${4 + bar * 2.5}px` }}
        />
      ))}
    </span>
  );
}

function wifiSecurityLabel(security) {
  return {
    open: 'Open',
    wpa2: 'WPA2',
    wpa3: 'WPA3',
    wpa2_wpa3: 'WPA2/WPA3',
    enhanced_open: 'Enhanced Open',
    enterprise: 'Enterprise',
    wep: 'WEP',
  }[String(security || '').toLowerCase()] || 'Unknown';
}

function WifiJoinModal({ network, onClose, onJoin }) {
  const dialogRef = useRef(null);
  const [security, setSecurity] = useState('open');
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    if (!network) return undefined;
    setSecurity(network.security === 'wpa2_wpa3' ? 'wpa2' : network.security);
    setPassphrase('');
    const previouslyFocused = document.activeElement;
    window.setTimeout(() => dialogRef.current?.querySelector('input, select, button')?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    };
  }, [network, onClose]);

  if (!network) return null;
  const secure = security !== 'open';
  const passwordValid = !secure || (new TextEncoder().encode(passphrase).length >= 8 && new TextEncoder().encode(passphrase).length <= 63);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <form
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wifi-join-title"
          className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (!passwordValid) return;
            onJoin({
              ssid: network.ssid,
              security,
              ...(secure ? { passphrase } : {}),
            });
            setPassphrase('');
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="wifi-join-title" className="text-lg font-black text-slate-900">Join Wi-Fi network</h2>
              <p className="mt-1 break-all text-sm font-semibold text-slate-600">{network.ssid}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close Wi-Fi join dialog">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {network.security === 'wpa2_wpa3' ? (
            <label className="mt-5 block text-xs font-bold text-slate-700">
              Security
              <select value={security} onChange={(event) => setSecurity(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-800">
                <option value="wpa2">WPA2 compatibility</option>
                <option value="wpa3">WPA3</option>
              </select>
            </label>
          ) : (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              Security: {wifiSecurityLabel(security)}
            </div>
          )}

          {secure && (
            <label className="mt-4 block text-xs font-bold text-slate-700">
              Wi-Fi password
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
                spellCheck="false"
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
                placeholder="8–63 characters"
              />
            </label>
          )}

          <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] leading-4 text-blue-800">
            Agent will verify internet access before keeping this network. If validation fails, it restores the previous Wi-Fi connection automatically.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200">Cancel</button>
            <button type="submit" disabled={!passwordValid} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">Join network</button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function PhoneNetworkCard({
  device,
  now,
  canControl,
  canJoin,
  isAdmin,
  onScan,
  onJoin,
  onOpenCaptivePortal,
  onWifiToggle,
  onToggleHotspot,
  onToggleAlwaysOnHotspot,
}) {
  const inventory = device?.inventory || {};
  const networks = inventory.availableWifiNetworks || [];
  const networkToolsReady = inventory.commandEncryptionReady;
  const wifiSignalText = inventory.wifiRssiDbm == null ? 'Signal unavailable' : `${inventory.wifiRssiDbm} dBm`;
  const cellularSignalText = inventory.cellularSignalDbm == null ? 'Signal unavailable' : `${inventory.cellularSignalDbm} dBm`;
  const status = inventory.wifiCaptivePortal
    ? { label: 'Sign-in required', tone: 'bg-amber-100 text-amber-800' }
    : inventory.networkStatus === 'online'
      ? { label: 'Internet online', tone: 'bg-emerald-100 text-emerald-700' }
      : inventory.networkStatus === 'no_internet'
        ? { label: 'No internet', tone: 'bg-red-100 text-red-700' }
      : inventory.networkStatus === 'local_only'
          ? { label: 'Local network only', tone: 'bg-amber-100 text-amber-800' }
          : !inventory.networkStatus && inventory.network !== 'offline'
            ? { label: 'Connected', tone: 'bg-blue-100 text-blue-700' }
          : { label: 'Offline', tone: 'bg-slate-100 text-slate-600' };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <SignalIcon className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black text-slate-900">Network</h3>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status.tone}`}>{status.label}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {!networkToolsReady
              ? 'Update Agent to load signal and nearby Wi-Fi details'
              : inventory.availableWifiScannedAt
              ? `Nearby networks updated ${formatPhoneRelativeTime(inventory.availableWifiScannedAt, now)}`
              : 'Scan the phone for nearby Wi-Fi networks'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inventory.wifiCaptivePortal && (
            <button type="button" onClick={onOpenCaptivePortal} disabled={!canControl} className="min-h-8 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40">
              Open sign-in
            </button>
          )}
          <button type="button" onClick={onScan} disabled={!canControl || !inventory.wifiEnabled || !inventory.locationEnabled || !networkToolsReady} title={!networkToolsReady ? 'Update Agent to enable network scanning' : !inventory.locationEnabled ? 'Turn GPS on before scanning for Wi-Fi networks' : ''} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40">
            <ArrowPathIcon className="h-3.5 w-3.5" />
            Scan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/60 px-3 pt-3">
        <WifiToggle
          enabled={inventory.hotspotActive}
          icon={WifiIcon}
          onToggle={onToggleHotspot}
          disabled={!canControl || !inventory.hotspotSupported || !inventory.hotspotControlGranted}
          title={!inventory.hotspotSupported
            ? 'Hotspot control requires Android 16 or newer'
            : !inventory.hotspotControlGranted
              ? 'Open Agent on the phone and approve hotspot control first'
              : ''}
          label="Hotspot"
          compact
        />
        <WifiToggle
          enabled={inventory.hotspotAlwaysOn}
          onToggle={onToggleAlwaysOnHotspot}
          disabled={!canControl || !inventory.hotspotSupported || !inventory.hotspotControlGranted}
          label="Always on"
          icon={ArrowPathIcon}
          compact
        />
        {inventory.hotspotLastError && inventory.hotspotAlwaysOn && !inventory.hotspotActive && (
          <p className="col-span-2 mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            {humanizePhoneMessage(inventory.hotspotLastError)}
          </p>
        )}
      </div>

      <div className="grid gap-2 border-t border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-700"><WifiIcon className="h-4 w-4 text-blue-600" />Wi-Fi</span>
            <NetworkSignalBars dbm={inventory.wifiRssiDbm} level={inventory.wifiSignalLevel} active={inventory.wifiEnabled && inventory.wifiConnected} label={`Wi-Fi ${wifiSignalText}`} />
          </div>
          <p className="mt-2 truncate text-sm font-black text-slate-900">{inventory.wifiSsid || (inventory.wifiConnected ? 'Connected' : inventory.wifiEnabled ? 'Not connected' : 'Wi-Fi is off')}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {[wifiSignalText, inventory.wifiBand, inventory.wifiLinkSpeedMbps == null ? '' : `${inventory.wifiLinkSpeedMbps} Mbps`].filter(Boolean).join(' · ')}
          </p>
          <WifiToggle enabled={inventory.wifiEnabled} onToggle={onWifiToggle} disabled={!canControl} className="mt-3 w-full" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-700"><SignalIcon className="h-4 w-4 text-blue-600" />Cellular</span>
            <NetworkSignalBars dbm={inventory.cellularSignalDbm} type="cellular" level={inventory.cellularSignalLevel} active={inventory.cellularSignalDbm != null} label={`Cellular ${cellularSignalText}`} />
          </div>
          <p className="mt-2 truncate text-sm font-black text-slate-900">{inventory.cellularCarrier || 'Carrier unavailable'}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {[cellularSignalText, inventory.cellularTechnology, inventory.cellularDataConnected ? 'Data connected' : 'Data idle'].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black text-slate-800">Available Wi-Fi</p>
          {!canJoin && (
            <span className="text-[10px] font-semibold text-slate-400">
              {isAdmin && !inventory.commandEncryptionReady ? 'Update Agent to enable joining' : 'Joining is Admin only'}
            </span>
          )}
        </div>
        {networks.length ? (
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {networks.map((network, index) => (
              <div key={`${network.ssid}-${network.security}-${index}`} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${network.connected ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                <NetworkSignalBars dbm={network.signalDbm} level={network.signalLevel} active={inventory.wifiEnabled} label={`${network.ssid} ${network.signalDbm == null ? '' : `${network.signalDbm} dBm`}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800">{network.ssid}</p>
                  <p className="mt-0.5 truncate text-[10px] text-slate-500">{[wifiSecurityLabel(network.security), network.band, network.signalDbm == null ? '' : `${network.signalDbm} dBm`].filter(Boolean).join(' · ')}</p>
                </div>
                {network.connected ? (
                  <span className="shrink-0 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700">Connected</span>
                ) : canJoin && network.joinSupported ? (
                  <button type="button" onClick={() => onJoin(network)} className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100">Join</button>
                ) : network.joinSupported ? null : (
                  <span className="shrink-0 text-[10px] font-semibold text-slate-400">Manual setup</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
            {!networkToolsReady
              ? 'Update Agent to enable network diagnostics.'
              : !inventory.locationEnabled
                ? 'Turn GPS on above to scan nearby Wi-Fi networks.'
              : inventory.wifiEnabled
                ? 'No nearby networks reported yet.'
                : 'Turn Wi-Fi on to scan nearby networks.'}
          </p>
        )}
      </div>
    </section>
  );
}

function RemoteScreen({
  device,
  canControl,
  canInput,
  canSendCommand,
  onCommand,
  onPrepareRealtime,
  onRealtimeError,
  onStartRealtime,
  onStopRealtime,
  onStartPreview,
  onStopPreview,
  liveRequested,
  remoteInputAvailable,
  now,
}) {
  const [profileKey, setProfileKey] = useState('balanced');
  const [rtcState, setRtcState] = useState('idle');
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [controlReady, setControlReady] = useState(false);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const videoRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const imageRef = useRef(null);
  const sessionIdRef = useRef('');
  const startAttemptRef = useRef(0);
  const pointerRef = useRef(null);
  const imageUrl = String(device?.screen?.dataUrl || device?.screen?.latestUrl || device?.screen?.imageUrl || '').trim();
  const screenWidth = Number(device?.screen?.width || 1080);
  const screenHeight = Number(device?.screen?.height || 2400);
  const liveExpiresAt = phoneTimestampToMillis(device?.screen?.live?.expiresAt);
  const liveActive = device?.screen?.live?.active === true && liveExpiresAt > now;
  const webRtc = device?.screen?.webrtc || {};
  const serverRtcState = String(webRtc.state || '');
  const webRtcExpiresAt = phoneTimestampToMillis(webRtc.expiresAt);
  const webRtcActive = isPhoneWebRtcActive(webRtc, now);
  const directControl = controlReady;
  const realtimeFailureMessage = !liveRequested && {
    failed: webRtc.error || 'Live screen could not connect. Refresh the dashboard and try again.',
    permission_denied: 'Android did not allow screen sharing. Start live again to retry.',
    expired: 'The live screen request expired. Start live again to retry.',
    projection_stopped: 'Android stopped screen sharing. Start live again to retry.',
  }[serverRtcState];

  const closePeer = useCallback((nextState = 'idle') => {
    startAttemptRef.current += 1;
    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
    sessionIdRef.current = '';
    pointerRef.current = null;
    setControlReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setHasRemoteVideo(false);
    setRtcState(nextState);
  }, []);

  useEffect(() => () => closePeer(), [closePeer, device?.id]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = remoteStreamRef.current;
    if (!hasRemoteVideo || !video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [hasRemoteVideo]);

  useEffect(() => {
    const peer = peerRef.current;
    if (!peer || !sessionIdRef.current || webRtc.sessionId !== sessionIdRef.current) return;
    if (webRtc.answerSdp && !peer.currentRemoteDescription) {
      peer.setRemoteDescription({ type: 'answer', sdp: webRtc.answerSdp })
        .then(() => setRtcState('connecting'))
        .catch(() => closePeer('failed'));
    }
    if (serverRtcState === 'connected') setRtcState('connected');
    if (['failed', 'permission_denied', 'expired', 'projection_stopped'].includes(serverRtcState)) {
      closePeer(serverRtcState);
    }
  }, [closePeer, serverRtcState, webRtc.answerSdp, webRtc.sessionId]);

  useEffect(() => {
    const expirableState = ['awaiting_permission', 'starting', 'connecting', 'connected', 'disconnected']
      .includes(serverRtcState);
    if (expirableState && webRtc.sessionId === sessionIdRef.current &&
        webRtcExpiresAt > 0 && webRtcExpiresAt <= now) {
      closePeer('expired');
    }
  }, [closePeer, now, serverRtcState, webRtc.sessionId, webRtcExpiresAt]);

  const sendDirect = (packet) => {
    if (channelRef.current?.readyState !== 'open') return false;
    channelRef.current.send(packet);
    return true;
  };

  const startRealtime = async () => {
    if (!canControl || typeof window.RTCPeerConnection !== 'function') return;
    closePeer('preparing');
    const attemptId = startAttemptRef.current;
    try {
      const iceServers = await onPrepareRealtime();
      if (attemptId !== startAttemptRef.current) return;
      const sessionId = createWebRtcSessionId();
      const peer = new window.RTCPeerConnection({ iceServers });
      const channel = peer.createDataChannel('chargerent-control-v1', { ordered: true });
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => {
        setControlReady(true);
        setRtcState('connected');
      };
      channel.onclose = () => {
        setControlReady(false);
        setRtcState((current) => current === 'stopped' ? current : 'disconnected');
      };
      channelRef.current = channel;
      peerRef.current = peer;
      sessionIdRef.current = sessionId;
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.ontrack = (event) => {
        const [announcedStream] = event.streams;
        const stream = announcedStream || (event.track && typeof window.MediaStream === 'function'
          ? new window.MediaStream([event.track])
          : null);
        if (stream) {
          remoteStreamRef.current = stream;
          setHasRemoteVideo(true);
        }
      };
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        setRtcState(state);
        if (['failed', 'closed'].includes(state)) closePeer(state);
      };
      setRtcState('creating_offer');
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGatheringComplete(peer);
      if (attemptId !== startAttemptRef.current) return;
      const queued = await onStartRealtime({
        sessionId,
        offerSdp: peer.localDescription?.sdp || '',
        durationSeconds: 300,
        iceServers,
        profile: PHONE_WEBRTC_PROFILES[profileKey],
      });
      if (attemptId !== startAttemptRef.current) return;
      if (!queued) closePeer('failed');
      else setRtcState('awaiting_device');
    } catch (error) {
      if (attemptId === startAttemptRef.current) {
        closePeer('failed');
        onRealtimeError(error);
      }
    }
  };

  const stopRealtime = () => {
    const sessionId = sessionIdRef.current || webRtc.sessionId || '';
    closePeer('stopped');
    onStopRealtime(sessionId);
  };

  const pointerPoint = (event) => mediaPoint(
    event,
    hasRemoteVideo ? videoRef.current : imageRef.current,
  );

  const handlePointerDown = (event) => {
    if (!canInput || (!hasRemoteVideo && !imageUrl)) return;
    const point = pointerPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerRef.current = {
      ...point,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: performance.now(),
    };
    if (directControl) sendDirect(encodePointerPacket('down', point.x, point.y, 0));
  };

  const handlePointerMove = (event) => {
    if (!pointerRef.current || !directControl) return;
    const point = pointerPoint(event);
    if (!point) return;
    sendDirect(encodePointerPacket(
      'move', point.x, point.y, performance.now() - pointerRef.current.startedAt,
    ));
  };

  const handlePointerUp = (event) => {
    const start = pointerRef.current;
    if (!canInput || !start) return;
    const end = pointerPoint(event);
    pointerRef.current = null;
    if (!end) return;
    if (directControl) {
      sendDirect(encodePointerPacket('up', end.x, end.y, performance.now() - start.startedAt));
      return;
    }
    const travel = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    if (travel < 12) {
      onCommand('UI_TAP', {
        x: Math.round(end.x * Math.max(0, screenWidth - 1)),
        y: Math.round(end.y * Math.max(0, screenHeight - 1)),
      });
      return;
    }
    onCommand('UI_SWIPE', {
      startX: Math.round(start.x * Math.max(0, screenWidth - 1)),
      startY: Math.round(start.y * Math.max(0, screenHeight - 1)),
      endX: Math.round(end.x * Math.max(0, screenWidth - 1)),
      endY: Math.round(end.y * Math.max(0, screenHeight - 1)),
      durationMs: Math.max(150, Math.min(performance.now() - start.startedAt, 1_500)),
    });
  };

  const cancelPointer = () => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (start && directControl) {
      sendDirect(encodePointerPacket('cancel', start.x, start.y, performance.now() - start.startedAt));
    }
  };

  const globalAction = (action) => {
    if (!sendDirect(encodeGlobalActionPacket(action))) {
      onCommand('UI_GLOBAL_ACTION', { action });
    }
  };

  const swipeUp = () => {
    if (!directControl) {
      onCommand('UI_SWIPE', {
        startX: Math.round(screenWidth * 0.5),
        startY: Math.round(screenHeight * 0.82),
        endX: Math.round(screenWidth * 0.5),
        endY: Math.round(screenHeight * 0.25),
        durationMs: 450,
      });
      return;
    }
    sendDirect(encodePointerPacket('down', 0.5, 0.82, 0));
    for (let step = 1; step <= 8; step += 1) {
      window.setTimeout(() => {
        const progress = step / 8;
        const y = 0.82 + (0.25 - 0.82) * progress;
        sendDirect(encodePointerPacket(step === 8 ? 'up' : 'move', 0.5, y, step * 45));
      }, step * 45);
    }
  };

  const swipeDown = () => {
    if (!directControl) {
      onCommand('UI_SWIPE', {
        startX: Math.round(screenWidth * 0.5),
        startY: Math.round(screenHeight * 0.25),
        endX: Math.round(screenWidth * 0.5),
        endY: Math.round(screenHeight * 0.82),
        durationMs: 450,
      });
      return;
    }
    sendDirect(encodePointerPacket('down', 0.5, 0.25, 0));
    for (let step = 1; step <= 8; step += 1) {
      window.setTimeout(() => {
        const progress = step / 8;
        const y = 0.25 + (0.82 - 0.25) * progress;
        sendDirect(encodePointerPacket(step === 8 ? 'up' : 'move', 0.5, y, step * 45));
      }, step * 45);
    }
  };

  const changeProfile = (event) => {
    const nextKey = event.target.value;
    setProfileKey(nextKey);
    if (sessionIdRef.current && webRtcActive) {
      onCommand('SET_WEBRTC_PROFILE', {
        sessionId: sessionIdRef.current,
        profile: PHONE_WEBRTC_PROFILES[nextKey],
      });
    }
  };

  const realtimeStarting = liveRequested ||
    ['preparing', 'creating_offer', 'awaiting_device', 'new', 'connecting'].includes(rtcState) ||
    (webRtcActive && ['awaiting_permission', 'starting', 'connecting'].includes(serverRtcState));
  const realtimeConnected = webRtcActive &&
    (rtcState === 'connected' || serverRtcState === 'connected');
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-950 p-3 shadow-inner">
      <div className="mx-auto mb-3 flex w-full max-w-[240px] gap-2">
        <button
          type="button"
          onClick={webRtcActive || realtimeStarting || realtimeConnected ? stopRealtime : startRealtime}
          disabled={!canControl}
          className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${webRtcActive || realtimeStarting || realtimeConnected ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}
        >
          {webRtcActive || realtimeStarting || realtimeConnected ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {realtimeConnected ? 'Stop live' : realtimeStarting || webRtcActive ? 'Starting…' : 'Start live'}
        </button>
        <ActionButton icon={DevicePhoneMobileIcon} onClick={() => onCommand('CAPTURE_SCREEN')} disabled={!canSendCommand} tone="blue" className="flex-1 !px-2">Capture</ActionButton>
      </div>

      {!remoteInputAvailable && (
        <p className="mx-auto mb-3 max-w-[360px] rounded-lg border border-amber-500/40 bg-amber-400/10 px-3 py-2 text-center text-[11px] font-semibold leading-4 text-amber-200">
          Remote control is off on this phone. Open Android Settings → Accessibility → Agent and enable Remote UI control.
        </p>
      )}

      <div className="mx-auto flex aspect-[9/19.5] max-h-[520px] max-w-[240px] items-center justify-center overflow-hidden rounded-[1.5rem] border-4 border-slate-700 bg-black">
        {realtimeFailureMessage ? (
          <div className="px-5 text-center">
            <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-400" />
            <p className="mt-3 text-xs font-bold text-red-300">Live screen unavailable</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">{humanizePhoneMessage(realtimeFailureMessage)}</p>
          </div>
        ) : hasRemoteVideo || imageUrl ? (
          <button
            type="button"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelPointer}
            disabled={!canInput}
            className="h-full w-full touch-none cursor-crosshair select-none disabled:cursor-default"
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`${hasRemoteVideo ? 'block' : 'hidden'} h-full w-full object-contain`}
            />
            {!hasRemoteVideo && <img ref={imageRef} src={imageUrl} alt={`Screen preview for ${device.stationId || device.id}`} className="h-full w-full object-contain" />}
          </button>
        ) : (
          <div className="px-5 text-center">
            <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-slate-700" />
            <p className="mt-3 text-xs font-semibold text-slate-400">No screen frame received</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-600">Navigation controls remain available when the phone is online.</p>
          </div>
        )}
      </div>

      <div className="mx-auto mt-3 flex max-w-[360px] items-center gap-2">
        <select value={profileKey} onChange={changeProfile} className="min-h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-bold text-slate-200">
          {Object.entries(PHONE_WEBRTC_PROFILES).map(([key, profile]) => (
            <option key={key} value={key}>{profile.label}</option>
          ))}
        </select>
        <button type="button" onClick={liveActive ? onStopPreview : onStartPreview} disabled={!canSendCommand} className="min-h-9 rounded-lg border border-slate-700 px-3 text-[11px] font-bold text-slate-300 hover:bg-slate-900 disabled:opacity-40">
          {liveActive ? 'Stop preview' : 'Fallback preview'}
        </button>
      </div>

      <div className="mx-auto mt-3 grid max-w-[360px] grid-cols-3 gap-2">
        <ActionButton icon={ArrowUturnLeftIcon} onClick={() => globalAction('BACK')} disabled={!canInput}>Back</ActionButton>
        <ActionButton icon={HomeIcon} onClick={() => globalAction('HOME')} disabled={!canInput}>Home</ActionButton>
        <ActionButton icon={Squares2X2Icon} onClick={() => globalAction('RECENTS')} disabled={!canInput}>Recent</ActionButton>
        <ActionButton icon={ArrowUpIcon} onClick={swipeUp} disabled={!canInput} className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Swipe up</ActionButton>
        <ActionButton icon={ArrowDownIcon} onClick={swipeDown} disabled={!canInput} className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Swipe down</ActionButton>
        <ActionButton icon={WifiIcon} onClick={() => onCommand('OPEN_TETHER_SETTINGS')} disabled={!canSendCommand} tone="blue" className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Tethering</ActionButton>
      </div>
      <div className="mx-auto mt-2 grid max-w-[360px] grid-cols-2 gap-2">
        <ActionButton icon={LockOpenIcon} onClick={() => onCommand('WAKE_AND_UNLOCK')} disabled={!canSendCommand} tone="blue">Unlock</ActionButton>
        <ActionButton icon={LockClosedIcon} onClick={() => onCommand('LOCK_NOW')} disabled={!canSendCommand || webRtcActive} title={webRtcActive ? 'Stop the live stream before locking the phone' : ''} tone="amber">Lock</ActionButton>
      </div>
      <p className="mt-3 text-center text-[10px] leading-4 text-slate-500">
        The phone stays awake during live sessions. Android ends screen sharing if the hardware or dashboard Lock control is used.
      </p>
    </section>
  );
}

export default function PhoneControlPage({
  onNavigateToDashboard,
  onLogout,
  currentUser,
  allStationsData = [],
  t = (key) => key,
}) {
  const [devices, setDevices] = useState([]);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [commandStatus, setCommandStatus] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [assignmentStationId, setAssignmentStationId] = useState('');
  const [assignmentTerminalEnabled, setAssignmentTerminalEnabled] = useState(false);
  const [enrollmentCountry, setEnrollmentCountry] = useState('CA');
  const [enrollmentStationId, setEnrollmentStationId] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [addPhoneOpen, setAddPhoneOpen] = useState(false);
  const [liveRequestedDeviceId, setLiveRequestedDeviceId] = useState('');
  const [agentUpdateChecking, setAgentUpdateChecking] = useState(false);
  const [paymentUpdateChecking, setPaymentUpdateChecking] = useState(false);
  const [agentRelease, setAgentRelease] = useState(null);
  const [agentReleaseLoading, setAgentReleaseLoading] = useState(true);
  const [wifiJoinNetwork, setWifiJoinNetwork] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const openAddPhone = useCallback(() => setAddPhoneOpen(true), []);
  const closeAddPhone = useCallback(() => setAddPhoneOpen(false), []);
  const closeWifiJoin = useCallback(() => setWifiJoinNetwork(null), []);
  const changeEnrollmentCountry = useCallback((countryCode) => {
    setEnrollmentCountry(countryCode);
    setEnrollmentStationId('');
    setEnrollmentCode('');
  }, []);
  const changeEnrollmentStation = useCallback((stationId) => {
    setEnrollmentStationId(stationId);
    setEnrollmentCode('');
  }, []);

  const isAdmin = currentUser?.isAdmin === true || currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const hasPhoneControlAccess = isAdmin || currentUser?.features?.phone_control === true;
  const accessibleKiosks = useMemo(
    () => filterStationsForClient(allStationsData, currentUser),
    [allStationsData, currentUser],
  );

  const loadDevices = useCallback(async (showSpinner = false) => {
    if (!hasPhoneControlAccess) {
      setDevices([]);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const response = await callFunctionWithAuth('phoneControl_listDevices');
      const nextDevices = (Array.isArray(response?.devices) ? response.devices : [])
        .map((device) => normalizePhoneDevice(device, device.id || device.deviceId))
        .sort((left, right) => (
          (left.stationId || 'ZZZZ').localeCompare(right.stationId || 'ZZZZ') || left.id.localeCompare(right.id)
        ));
      setDevices(nextDevices);
      setLoadError('');
      setSelectedDeviceId((current) => (
        nextDevices.some((device) => device.id === current) ? current : nextDevices[0]?.id || ''
      ));
    } catch (error) {
      console.error('Unable to load managed phones', error);
      setLoadError('Unable to load managed phones. The Mobile Device Management service may not be deployed yet.');
    } finally {
      setLoading(false);
    }
  }, [hasPhoneControlAccess]);

  useEffect(() => {
    loadDevices(true);
    const interval = window.setInterval(() => loadDevices(false), 15_000);
    return () => window.clearInterval(interval);
  }, [loadDevices]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    setAgentReleaseLoading(true);
    fetchCurrentAgentRelease()
      .then((release) => {
        if (active) setAgentRelease(release);
      })
      .catch((error) => {
        if (active) {
          setAgentRelease(null);
          console.error('Unable to load the current Agent release', error);
        }
      })
      .finally(() => {
        if (active) setAgentReleaseLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadCommands = useCallback(async () => {
    if (!selectedDeviceId || !hasPhoneControlAccess) {
      setCommands([]);
      return;
    }
    try {
      const response = await callFunctionWithAuth('phoneControl_listCommands', {
        deviceId: selectedDeviceId,
      });
      setCommands((Array.isArray(response?.commands) ? response.commands : [])
        .sort((left, right) => commandTimestamp(right) - commandTimestamp(left))
        .slice(0, 3));
    } catch (error) {
      console.error('Unable to load phone command activity', error);
    }
  }, [hasPhoneControlAccess, selectedDeviceId]);

  useEffect(() => {
    loadCommands();
    const interval = window.setInterval(loadCommands, 5_000);
    return () => window.clearInterval(interval);
  }, [loadCommands]);

  useEffect(() => {
    if (!selectedDeviceId || !hasPhoneControlAccess) return undefined;
    let cancelled = false;
    let timeoutId = null;

    const loadScreen = async () => {
      let nextDelayMs = liveRequestedDeviceId === selectedDeviceId ? 1_500 : 5_000;
      try {
        const response = await callFunctionWithAuth('phoneControl_getScreen', {
          deviceId: selectedDeviceId,
        }, { forceRefreshToken: false });
        if (cancelled) return;
        const nextScreen = response?.screen && typeof response.screen === 'object' ? response.screen : {};
        setDevices((current) => current.map((device) => (
          device.id === selectedDeviceId ? { ...device, screen: nextScreen } : device
        )));
        const liveActive = nextScreen.live?.active === true &&
          phoneTimestampToMillis(nextScreen.live?.expiresAt) > Date.now();
        const webRtcState = String(nextScreen.webrtc?.state || '');
        const webRtcExpiresAt = phoneTimestampToMillis(nextScreen.webrtc?.expiresAt);
        const webRtcActive = isPhoneWebRtcActive(nextScreen.webrtc, Date.now());
        const webRtcExpired = ['awaiting_permission', 'starting', 'connecting', 'disconnected']
          .includes(webRtcState) && webRtcExpiresAt > 0 && webRtcExpiresAt <= Date.now();
        if (liveActive || webRtcActive) {
          nextDelayMs = webRtcActive ? 1_000 : 1_500;
          setLiveRequestedDeviceId('');
        } else if (webRtcExpired || ['failed', 'permission_denied', 'expired', 'projection_stopped', 'stopped'].includes(webRtcState)) {
          nextDelayMs = 5_000;
          if (webRtcExpired && liveRequestedDeviceId === selectedDeviceId) {
            setCommandStatus({
              state: 'error',
              message: 'Live screen timed out before Android approved screen sharing.',
            });
          } else if (liveRequestedDeviceId === selectedDeviceId && webRtcState !== 'stopped') {
            setCommandStatus({
              state: 'error',
              message: humanizePhoneMessage(
                nextScreen.webrtc?.error || 'Live screen could not connect. Refresh the dashboard and try again.',
              ),
            });
          }
          setLiveRequestedDeviceId('');
        }
      } catch (error) {
        if (!cancelled) console.error('Unable to refresh the live phone screen', error);
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(loadScreen, nextDelayMs);
        }
      }
    };

    loadScreen();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [hasPhoneControlAccess, liveRequestedDeviceId, selectedDeviceId]);

  const kioskByStationId = useMemo(() => new Map(
    accessibleKiosks.map((kiosk) => [stationIdOf(kiosk), kiosk]).filter(([stationId]) => stationId),
  ), [accessibleKiosks]);

  const assignedStationIds = useMemo(() => new Set(
    devices.map((device) => device.stationId).filter(Boolean),
  ), [devices]);

  const kioskOptions = useMemo(() => accessibleKiosks
    .map((kiosk) => ({
      stationId: stationIdOf(kiosk),
      countryCode: getPhoneKioskCountryCode(kiosk),
      label: kiosk?.info?.location || kiosk?.info?.place || kiosk?.info?.client || '',
    }))
    .filter((kiosk) => kiosk.stationId)
    .sort((left, right) => left.stationId.localeCompare(right.stationId)), [accessibleKiosks]);

  const enrollmentKioskOptions = useMemo(() => (
    kioskOptions.filter((kiosk) => kiosk.countryCode === enrollmentCountry)
  ), [enrollmentCountry, kioskOptions]);

  const filteredDevices = useMemo(() => devices.filter((device) => {
    const connection = getPhoneConnectionState(device, now);
    if (filter === 'online' && connection !== 'online') return false;
    if (filter === 'offline' && connection === 'online') return false;
    if (filter === 'unassigned' && device.stationId) return false;
    return phoneMatchesSearch(device, kioskByStationId.get(device.stationId), search);
  }), [devices, filter, kioskByStationId, now, search]);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || null;
  const selectedKiosk = selectedDevice ? getKioskForPhone(selectedDevice, accessibleKiosks) : null;
  const selectedConnection = getPhoneConnectionState(selectedDevice, now);
  const selectedTerminalStyle = TERMINAL_STYLES[selectedDevice?.terminal?.state] ||
    (selectedDevice?.terminal?.enabled ? TERMINAL_STYLES.pending : TERMINAL_STYLES.disabled);
  const selectedTerminalAgentReady = Number(selectedDevice?.inventory?.agentVersionCode || 0) >=
    TERMINAL_AGENT_MIN_VERSION_CODE;
  const selectedTerminalLocked = selectedDevice?.inventory?.terminalLockdownActive === true ||
    selectedDevice?.terminal?.lockdownEnabled === true;
  const assignmentUnchanged = assignmentStationId === selectedDevice?.stationId &&
    assignmentTerminalEnabled === (selectedDevice?.terminal?.enabled === true);
  const canControlSelected = hasPhoneControlAccess && selectedConnection === 'online' && selectedDevice?.enrollmentState === 'enrolled';
  const selectedRemoteInputAvailable = isPhoneRemoteInputAvailable(selectedDevice, now);
  const selectedModelCohort = useMemo(() => {
    if (!selectedDevice) return null;
    const manufacturer = String(selectedDevice.inventory.manufacturer || '').trim().toLowerCase();
    const model = String(selectedDevice.inventory.model || '').trim().toLowerCase();
    if (!model) return null;
    const members = devices.filter((device) => (
      String(device.inventory.manufacturer || '').trim().toLowerCase() === manufacturer &&
      String(device.inventory.model || '').trim().toLowerCase() === model
    ));
    const reportedVersions = members
      .map((device) => String(device.inventory.androidVersion || '').trim())
      .filter(Boolean);
    const versions = [...new Set(reportedVersions)]
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    return {
      count: members.length,
      versions,
      aligned: reportedVersions.length === members.length && versions.length === 1,
    };
  }, [devices, selectedDevice]);
  const selectedModelVersionDetail = selectedModelCohort?.count === 1
    ? 'Only managed phone of this model'
    : selectedModelCohort?.aligned
      ? `Android ${selectedModelCohort.versions[0] || 'version unknown'} aligned across ${selectedModelCohort.count} phones`
      : `Version mismatch: ${selectedModelCohort?.versions.join(', ') || 'one or more unknown'}`;

  useEffect(() => {
    setAssignmentStationId(selectedDevice?.stationId || '');
    setAssignmentTerminalEnabled(selectedDevice?.terminal?.enabled === true);
  }, [selectedDevice?.id, selectedDevice?.stationId, selectedDevice?.terminal?.enabled]);

  const sendCommand = useCallback(async (operation, args = {}, confirmed = false) => {
    if (!selectedDevice?.id) return;
    const requestId = createPhoneCommandRequestId(operation, selectedDevice.id);
    const actionLabel = commandActionLabel(operation, args);
    const targetLabel = selectedDevice.stationId || selectedDevice.displayName || 'the phone';
    setCommandStatus({ state: 'sending', message: `${actionLabel}…` });

    try {
      const result = await callFunctionWithAuth('phoneControl_sendCommand', {
        requestId,
        deviceId: selectedDevice.id,
        operation,
        arguments: args,
        confirmed,
      });
      setCommandStatus({
        state: 'pending',
        message: `${actionLabel} request sent to ${targetLabel}.`,
      });
      return result;
    } catch (error) {
      setCommandStatus({ state: 'error', message: humanizePhoneMessage(error?.message || 'Phone command failed.') });
      return null;
    }
  }, [selectedDevice]);

  const requestCommand = useCallback((operation, args = {}) => {
    if (CONFIRMATION_REQUIRED_PHONE_OPERATIONS.has(operation)) {
      setConfirmation({ operation, args });
      return;
    }
    sendCommand(operation, args, false);
  }, [sendCommand]);

  const requestAgentUpdate = useCallback(async () => {
    if (!selectedDevice?.id || agentUpdateChecking) return;
    setAgentUpdateChecking(true);
    setCommandStatus({ state: 'sending', message: 'Checking for the latest Agent release…' });
    try {
      const release = await fetchCurrentAgentRelease();
      setAgentRelease(release);
      const installedVersionCode = Number(selectedDevice.inventory.agentVersionCode || 0);
      const sameNamedVersion = selectedDevice.inventory.agentVersion === release.versionName;
      if ((installedVersionCode > 0 && installedVersionCode >= release.versionCode) ||
          (!installedVersionCode && sameNamedVersion)) {
        setCommandStatus({
          state: 'success',
          message: `Agent ${release.versionName} is already installed on ${selectedDevice.stationId || 'this phone'}.`,
        });
        return;
      }
      setCommandStatus(null);
      setConfirmation({
        operation: 'INSTALL_APP_UPDATE',
        args: {
          httpsUrl: release.apkUrl,
          sha256: release.apkSha256,
          versionCode: release.versionCode,
          versionName: release.versionName,
        },
      });
    } catch (error) {
      setCommandStatus({
        state: 'error',
        message: humanizePhoneMessage(error?.message || 'Could not check for Agent updates.'),
      });
    } finally {
      setAgentUpdateChecking(false);
    }
  }, [agentUpdateChecking, selectedDevice]);

  const requestPaymentAppUpdate = useCallback(async () => {
    if (!selectedDevice?.id || paymentUpdateChecking) return;
    setPaymentUpdateChecking(true);
    setCommandStatus({ state: 'sending', message: 'Checking the current payment app release…' });
    try {
      const release = await fetchCurrentPaymentAppRelease();
      const assignedPackage = String(selectedDevice.terminal?.packageName || '').trim();
      if (assignedPackage && assignedPackage !== release.packageName) {
        throw new Error(`The published payment app does not match ${assignedPackage}.`);
      }
      setCommandStatus(null);
      setConfirmation({
        operation: 'INSTALL_PAYMENT_APP',
        args: {
          httpsUrl: release.apkUrl,
          sha256: release.apkSha256,
          packageName: release.packageName,
          versionCode: release.versionCode,
          versionName: release.versionName,
        },
      });
    } catch (error) {
      setCommandStatus({
        state: 'error',
        message: humanizePhoneMessage(error?.message || 'Could not check for payment app updates.'),
      });
    } finally {
      setPaymentUpdateChecking(false);
    }
  }, [paymentUpdateChecking, selectedDevice]);

  const startRealtimeScreen = useCallback(async (arguments_) => {
    if (!selectedDevice?.id) return;
    setLiveRequestedDeviceId(selectedDevice.id);
    return sendCommand('START_WEBRTC_SCREEN', arguments_, false);
  }, [selectedDevice, sendCommand]);

  const prepareRealtimeScreen = useCallback(async () => {
    if (!selectedDevice?.id) throw new Error('Select a managed phone first.');
    setCommandStatus({state: 'sending', message: 'Preparing secure live connection…'});
    const result = await callFunctionWithAuth('phoneControl_getIceServers', {
      deviceId: selectedDevice.id,
    }, {
      timeoutMs: 15_000,
      timeoutMessage: 'Secure live connection timed out. Please try again.',
    });
    return normalizePhoneWebRtcIceServers(result);
  }, [selectedDevice]);

  const reportRealtimeError = useCallback((error) => {
    setCommandStatus({
      state: 'error',
      message: humanizePhoneMessage(error?.message || 'Could not start the secure live connection.'),
    });
  }, []);

  const stopRealtimeScreen = useCallback((sessionId) => {
    setLiveRequestedDeviceId('');
    sendCommand('STOP_WEBRTC_SCREEN', { sessionId }, false);
  }, [sendCommand]);

  const startLivePreview = useCallback(() => {
    if (!selectedDevice?.id) return;
    sendCommand('START_LIVE_SCREEN', { durationSeconds: 120, intervalMs: 1_200 }, false);
  }, [selectedDevice, sendCommand]);

  const stopLivePreview = useCallback(() => {
    sendCommand('STOP_LIVE_SCREEN', {}, false);
  }, [sendCommand]);

  const joinWifiNetwork = useCallback((arguments_) => {
    setWifiJoinNetwork(null);
    sendCommand('CONNECT_WIFI', arguments_, false);
  }, [sendCommand]);

  const assignSelectedPhone = async () => {
    if (!selectedDevice?.id || !assignmentStationId) return;
    setCommandStatus({ state: 'sending', message: `Assigning phone to ${assignmentStationId}…` });
    try {
      const result = await callFunctionWithAuth('phoneControl_assignDevice', {
        deviceId: selectedDevice.id,
        stationId: assignmentStationId,
        terminalEnabled: assignmentTerminalEnabled,
      });
      setCommandStatus({ state: 'success', message: result?.message || `Phone assigned to ${assignmentStationId}.` });
      await loadDevices(false);
    } catch (error) {
      setCommandStatus({ state: 'error', message: error?.message || 'Phone assignment failed.' });
    }
  };

  const reprovisionSelectedTerminal = async () => {
    const stationId = selectedDevice?.stationId;
    if (!selectedDevice?.id || !stationId || selectedDevice.terminal?.enabled !== true) return;
    setCommandStatus({ state: 'sending', message: `Reprovisioning ${stationId} terminal…` });
    try {
      const result = await callFunctionWithAuth('phoneControl_assignDevice', {
        deviceId: selectedDevice.id,
        stationId,
        terminalEnabled: true,
      });
      setCommandStatus({
        state: 'success',
        message: result?.message || `Terminal reprovisioning queued for ${stationId}.`,
      });
      await loadDevices(false);
    } catch (error) {
      setCommandStatus({
        state: 'error',
        message: humanizePhoneMessage(error?.message || 'Terminal reprovisioning failed.'),
      });
    }
  };

  const createEnrollment = async () => {
    if (!enrollmentStationId) return;
    setCommandStatus({ state: 'sending', message: `Creating enrollment for ${enrollmentStationId}…` });
    setEnrollmentCode('');
    try {
      const result = await callFunctionWithAuth('phoneControl_createEnrollment', { stationId: enrollmentStationId });
      setEnrollmentCode(String(result?.enrollmentCode || ''));
      setCommandStatus({ state: 'success', message: result?.message || `Enrollment ready for ${enrollmentStationId}.` });
    } catch (error) {
      setCommandStatus({ state: 'error', message: error?.message || 'Could not create enrollment.' });
    }
  };

  const onlineCount = devices.filter((device) => getPhoneConnectionState(device, now) === 'online').length;
  const unassignedCount = devices.filter((device) => !device.stationId).length;
  const attentionCount = devices.filter((device) => (
    getPhoneConnectionState(device, now) !== 'online' || !device.inventory.isDeviceOwner ||
    !isPhoneRemoteInputAvailable(device, now)
  )).length;

  if (!hasPhoneControlAccess) {
    return <div className="min-h-screen bg-gray-100 p-6"><div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">Mobile Device Management is not enabled for this account.</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 text-slate-900">
      <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
      <WifiJoinModal
        network={wifiJoinNetwork}
        onClose={closeWifiJoin}
        onJoin={joinWifiNetwork}
      />
      <ConfirmationModal
        isOpen={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          sendCommand(confirmation.operation, confirmation.args, true);
          setConfirmation(null);
        }}
        details={phoneCommandConfirmationDetails(confirmation, selectedDevice)}
        t={t}
      />
      {isAdmin && (
        <PhoneEnrollmentModal
          isOpen={addPhoneOpen}
          onClose={closeAddPhone}
          enrollmentCountry={enrollmentCountry}
          onEnrollmentCountryChange={changeEnrollmentCountry}
          enrollmentStationId={enrollmentStationId}
          onEnrollmentStationIdChange={changeEnrollmentStation}
          enrollmentKioskOptions={enrollmentKioskOptions}
          assignedStationIds={assignedStationIds}
          enrollmentCode={enrollmentCode}
          onCreateEnrollment={createEnrollment}
        />
      )}

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="truncate text-xl font-black text-slate-900">Mobile Device Management</h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onNavigateToDashboard} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to dashboard" aria-label="Back to dashboard">
              <HomeIcon className="h-6 w-6" />
            </button>
            <button type="button" onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title={t('logout')} aria-label={t('logout')}>
              <PowerIcon className="h-6 w-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className={`grid grid-cols-2 gap-3 ${isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
          <SummaryCard label="Managed phones" value={devices.length} detail="One phone per assigned kiosk" />
          <SummaryCard label="Online" value={onlineCount} detail="Heartbeat within 90 seconds" tone="green" />
          <SummaryCard label="Needs attention" value={attentionCount} detail="Offline or missing control access" tone={attentionCount ? 'red' : 'green'} />
          <SummaryCard label="Unassigned" value={unassignedCount} detail="Not linked to a kiosk" tone={unassignedCount ? 'amber' : 'slate'} />
          {isAdmin && <AddPhoneCard onClick={openAddPhone} />}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label htmlFor="phone-search" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Find kiosk or phone</label>
              <input id="phone-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Station ID, location, client, model, or device ID" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${filter === item.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {loadError && <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>}

        {loading ? <LoadingSpinner t={t} /> : (
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Kiosk phones</h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">{filteredDevices.length}</span>
              </div>

              {filteredDevices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">No matching phones</p>
                  <p className="mt-1 text-xs text-slate-500">{isAdmin ? 'Select Add a phone above to connect the first kiosk phone.' : 'No managed phones are assigned to your partner kiosks.'}</p>
                </div>
              ) : filteredDevices.map((device) => {
                const kiosk = kioskByStationId.get(device.stationId);
                const connection = getPhoneConnectionState(device, now);
                const style = STATE_STYLES[connection];
                const selected = device.id === selectedDeviceId;
                return (
                  <button key={device.id} type="button" onClick={() => setSelectedDeviceId(device.id)} className={`w-full rounded-xl border p-4 text-left shadow-sm transition ${selected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                          <p className="truncate text-base font-black text-slate-900">{device.stationId || 'Unassigned phone'}</p>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{kiosk?.info?.location || kiosk?.info?.place || device.displayName || device.id}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${style.badge}`}>{style.label}</span>
                        {device.terminal.enabled && (
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${TERMINAL_STYLES[device.terminal.state]?.badge || TERMINAL_STYLES.pending.badge}`}>
                            {TERMINAL_STYLES[device.terminal.state]?.label || TERMINAL_STYLES.pending.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-slate-500">
                      <span className="truncate font-semibold">{device.inventory.model}</span>
                      <span className="shrink-0">{formatPhoneRelativeTime(device.lastSeenAtMs, now)}</span>
                    </div>
                  </button>
                );
              })}

            </section>

            <section className="min-w-0">
              {!selectedDevice ? (
                <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <div><DevicePhoneMobileIcon className="mx-auto h-14 w-14 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-700">Select a kiosk phone</p></div>
                </div>
              ) : (
                <div className="space-y-4">
                  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-black text-slate-900">{selectedDevice.stationId || 'Unassigned phone'}</h2>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${STATE_STYLES[selectedConnection].badge}`}>{STATE_STYLES[selectedConnection].label}</span>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${selectedDevice.inventory.isDeviceOwner ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{selectedDevice.inventory.isDeviceOwner ? 'Device Owner' : 'Owner missing'}</span>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${selectedTerminalStyle.badge}`}>{selectedTerminalStyle.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{selectedKiosk?.info?.location || selectedKiosk?.info?.place || 'No kiosk location'}{selectedKiosk?.info?.client ? ` · ${selectedKiosk.info.client}` : ''}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{selectedDevice.id}</p>
                      </div>
                      {isAdmin && <div className="min-w-[300px] rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex gap-2">
                          <select value={assignmentStationId} onChange={(event) => setAssignmentStationId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                            <option value="">Assign to kiosk</option>
                            {kioskOptions.map((kiosk) => <option key={kiosk.stationId} value={kiosk.stationId} disabled={assignedStationIds.has(kiosk.stationId) && kiosk.stationId !== selectedDevice.stationId}>{kiosk.stationId}</option>)}
                          </select>
                          <button type="button" onClick={assignSelectedPhone} disabled={!assignmentStationId || assignmentUnchanged} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">Save</button>
                        </div>
                        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <input
                            type="checkbox"
                            checked={assignmentTerminalEnabled}
                            onChange={(event) => setAssignmentTerminalEnabled(event.target.checked)}
                            disabled={(!selectedDevice.inventory.commandEncryptionReady || !selectedTerminalAgentReady) && !selectedDevice.terminal.enabled}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-xs font-black text-slate-800"><CreditCardIcon className="h-4 w-4 text-blue-600" />Run Stripe terminal on this phone</span>
                            <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">
                              {selectedDevice.inventory.commandEncryptionReady && selectedTerminalAgentReady
                                ? 'Provision this phone with the selected kiosk’s payment and V2 module configuration.'
                                : 'Update to Chargerent Agent 1.2.14 before enabling terminal provisioning and lockdown.'}
                            </span>
                          </span>
                        </label>
                      </div>}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
                      <Metric icon={Battery100Icon} label="Battery" value={selectedDevice.inventory.batteryPercent == null ? 'Unknown' : `${selectedDevice.inventory.batteryPercent}%${selectedDevice.inventory.batteryCharging ? ' · Charging' : ''}`} />
                      <Metric
                        icon={SignalIcon}
                        label="Network"
                        value={phoneNetworkLabel(selectedDevice.inventory)}
                        detail={selectedDevice.inventory.phoneNumber || 'Number unavailable'}
                        active={selectedDevice.inventory.network !== 'offline'}
                      />
                      <Metric icon={WifiIcon} label="Hotspot" value={phoneHotspotLabel(selectedDevice.inventory)} active={selectedDevice.inventory.hotspotActive} />
                      <Metric
                        icon={DevicePhoneMobileIcon}
                        label="Phone"
                        value={`${selectedDevice.inventory.model}${selectedDevice.inventory.androidVersion ? ` · Android ${selectedDevice.inventory.androidVersion}` : ''}`}
                        detail={selectedModelVersionDetail}
                        detailTone={selectedModelCohort?.aligned === false ? 'red' : 'slate'}
                      />
                      <AgentMetric
                        inventory={selectedDevice.inventory}
                        release={agentRelease}
                        releaseLoading={agentReleaseLoading}
                        updateChecking={agentUpdateChecking}
                        canControl={canControlSelected}
                        onUpdate={requestAgentUpdate}
                      />
                    </div>

                  </section>

                  <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
                    {selectedDevice.terminal.enabled ? (
                      <TerminalControlPanel
                        device={selectedDevice}
                        terminalStyle={selectedTerminalStyle}
                        locked={selectedTerminalLocked}
                        canControl={canControlSelected}
                        agentReady={selectedTerminalAgentReady}
                        paymentUpdateChecking={paymentUpdateChecking}
                        onToggleLockdown={() => requestCommand('SET_TERMINAL_LOCKDOWN', { enabled: !selectedTerminalLocked })}
                        onLaunch={() => requestCommand('LAUNCH_PAYMENT_APP')}
                        onReprovision={reprovisionSelectedTerminal}
                        onUpdatePaymentApp={requestPaymentAppUpdate}
                      />
                    ) : (
                      <RemoteScreen
                        device={selectedDevice}
                        canControl={canControlSelected}
                        canInput={canControlSelected && selectedRemoteInputAvailable}
                        canSendCommand={canControlSelected}
                        onCommand={requestCommand}
                        onPrepareRealtime={prepareRealtimeScreen}
                        onRealtimeError={reportRealtimeError}
                        onStartRealtime={startRealtimeScreen}
                        onStopRealtime={stopRealtimeScreen}
                        onStartPreview={startLivePreview}
                        onStopPreview={stopLivePreview}
                        liveRequested={liveRequestedDeviceId === selectedDevice.id}
                        remoteInputAvailable={selectedRemoteInputAvailable}
                        now={now}
                      />
                    )}

                    <div className="space-y-4">
                      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={ArrowPathIcon} onClick={() => requestCommand('REBOOT')} disabled={!canControlSelected} tone="amber">Reboot</ActionButton>
                          <ActionButton icon={PowerIcon} onClick={() => requestCommand('POWER_OFF')} disabled={!canControlSelected} tone="red">Shut down</ActionButton>
                        </div>
                      </section>
                      <PhoneLocationCard
                        device={selectedDevice}
                        now={now}
                        onRefresh={() => requestCommand('GET_LOCATION')}
                        onToggleLocation={() => requestCommand('SET_LOCATION_ENABLED', { enabled: !selectedDevice.inventory.locationEnabled })}
                        locationEnabled={selectedDevice.inventory.locationEnabled}
                        canRefresh={canControlSelected}
                      />
                      <PhoneNetworkCard
                        device={selectedDevice}
                        now={now}
                        canControl={canControlSelected}
                        canJoin={isAdmin && canControlSelected && selectedDevice.inventory.commandEncryptionReady}
                        isAdmin={isAdmin}
                        onScan={() => requestCommand('SCAN_WIFI_NETWORKS')}
                        onJoin={setWifiJoinNetwork}
                        onOpenCaptivePortal={() => requestCommand('OPEN_CAPTIVE_PORTAL')}
                        onWifiToggle={() => requestCommand('SET_WIFI_ENABLED', { enabled: !selectedDevice.inventory.wifiEnabled })}
                        onToggleHotspot={() => requestCommand('SET_HOTSPOT_ENABLED', { enabled: !selectedDevice.inventory.hotspotActive })}
                        onToggleAlwaysOnHotspot={() => requestCommand('SET_ALWAYS_ON_HOTSPOT', { enabled: !selectedDevice.inventory.hotspotAlwaysOn })}
                      />
                      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-base font-black text-slate-900">Command activity</h3>
                      <div className="mt-4 space-y-2">
                        {commands.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">No commands recorded for this phone.</p> : commands.map((command) => {
                          const state = String(command.status || 'queued').toLowerCase();
                          return (
                            <div key={command.id} className="rounded-lg border border-slate-200 px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-xs font-bold text-slate-800">{commandLabel(command.operation)}</span>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${COMMAND_STYLES[state] || COMMAND_STYLES.queued}`}>{state}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                                <span className="truncate font-mono">{command.id}</span>
                                <span className="shrink-0">{formatPhoneRelativeTime(commandTimestamp(command), now)}</span>
                              </div>
                              {(command.error || command.result?.message) && <p className="mt-2 text-xs text-slate-600">{humanizePhoneMessage(command.error || command.result.message)}</p>}
                            </div>
                          );
                        })}
                      </div>
                      </section>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
