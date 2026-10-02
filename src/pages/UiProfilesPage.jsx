import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  BoltIcon,
  ChevronRightIcon,
  CreditCardIcon,
  LockClosedIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';
import TerminalProfileEditor from '../components/profiles/TerminalProfileEditor.jsx';
import StripeProfileEditor from '../integrated-media/StripeProfileEditor.jsx';
import {PROFILE_SECTIONS, getProfileDeviceTypes, getTerminalProfileCopy, isProfileSectionTarget, mergeProfileSection} from '../../functions/uiProfileSections.mjs';
import {getApolloScreenFlowError} from '../../functions/apolloScreens.mjs';
import {isProfileDeviceSectionAvailable, profileDeviceStatus, profileSectionContent} from '../utils/profileDevices.js';
import {createProfilePreviewApi, PROFILE_PREVIEW_KIOSKS} from '../utils/profilePreview.js';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { formatDateTime } from '../utils/dateFormatter.js';
import { isKioskOnline } from '../utils/helpers.js';
import {normalizeChargerentAppProfile, readChargerentAppProfile, writeChargerentAppProfile} from '../utils/chargerentAppProfile.js';
import {
  DEFAULT_KIOSK_UI,
  KIOSK_PROFILE_LANGUAGES,
  cloneProfileValue,
  createKioskUiProfileFromTemplate,
  flattenLanguageFields,
  getNestedValue,
  normalizeKioskLanguages,
  resolveKioskUiSnapshot,
  setNestedValue,
} from '../utils/kioskUiProfiles.js';

const EDITOR_TABS = [
  { key: 'Content', label: 'Text' },
  { key: 'Colors', label: 'Colors' },
];
const LANGUAGE_LABELS = Object.fromEntries(KIOSK_PROFILE_LANGUAGES.map((language) => [language.key, language.label]));
const CONTENT_SECTIONS = [
  { key: 'start', label: 'Start', path: 'screens.start' },
  { key: 'rentReturn', label: 'Rent or return', path: 'screens.rentReturn' },
  { key: 'howItWorks', label: 'How it works', path: 'screens.howItWorks' },
  { key: 'returnInfo', label: 'Return instructions', path: 'screens.returnInfo' },
  { key: 'rentalComplete', label: 'Rental complete', path: 'screens.rentalComplete' },
  { key: 'returnComplete', label: 'Return complete', path: 'screens.returnComplete' },
  { key: 'wait', label: 'Please wait', path: 'screens.wait' },
  { key: 'receipt', label: 'Receipt', path: 'screens.receipt' },
  { key: 'terms', label: 'Terms', path: 'screens.terms' },
  { key: 'map', label: 'Map', path: 'screens.map' },
  { key: 'error', label: 'Transaction error', path: 'screens.error' },
  { key: 'declined', label: 'Card declined', path: 'screens.declined' },
  { key: 'outOfOrder', label: 'Out of order', path: 'screens.outOfOrder' },
  { key: 'purchasePricing', label: 'Purchase pricing', path: 'pricing.plans.PURCHASE_MIXED_DAILY' },
  { key: 'leasePricing', label: 'Lease pricing', path: 'pricing.plans.LEASE_SIMPLE_DAILY' },
  { key: 'pricingCommon', label: 'Cables', path: 'pricing.common' },
  { key: 'payment', label: 'Payment', path: 'pricing.payment' },
  { key: 'pricingUnavailable', label: 'Pricing unavailable', path: 'pricing.unavailable' },
  { key: 'support', label: 'Support message', path: 'support' },
];

const PAGE_BUTTON_CONTROLS = {
  start: [
    { key: 'language', label: 'Language', path: 'languages.active' },
    { key: 'map', label: 'Map', path: 'map.active' },
    { key: 'terms', label: 'Terms', path: 'terms.active' },
    { key: 'information', label: 'Information', path: 'information.active' },
  ],
  rentalComplete: [
    { key: 'receipt', label: 'Receipt', path: 'receipt.active' },
  ],
};

const PREVIEW_SCREENS = [
  { key: 'start', label: 'Start' },
  { key: 'rentReturn', label: 'Rent / Return' },
  { key: 'howItWorks', label: 'How it works' },
  { key: 'returnInfo', label: 'Return instructions' },
  { key: 'rentalComplete', label: 'Rental complete' },
  { key: 'returnComplete', label: 'Return complete' },
  { key: 'payment', label: 'Payment' },
  { key: 'wait', label: 'Please wait' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'terms', label: 'Terms' },
  { key: 'map', label: 'Map' },
  { key: 'error', label: 'Transaction error' },
  { key: 'declined', label: 'Card declined' },
  { key: 'outOfOrder', label: 'Out of order' },
];

const SECTION_PREVIEW_SCREEN = {
  purchasePricing: 'start',
  leasePricing: 'start',
  pricingCommon: 'start',
  pricingUnavailable: 'start',
  terminal: 'payment',
  support: 'start',
};

function normalizeClientId(value) {
  return String(value || '').trim().toUpperCase();
}
function profileSortValue(profile) {
  return normalizeClientId(profile.clientId);
}

function clientProfileDocumentId(clientId) {
  return normalizeClientId(clientId)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function profileRecency(profile) {
  const updatedAt = Date.parse(String(profile?.updatedAt || ''));
  return Number.isFinite(updatedAt) ? updatedAt : Number(profile?.version || 0);
}

function oneProfilePerClient(profiles) {
  const profilesByClient = new Map();
  profiles.forEach((profile) => {
    const clientId = normalizeClientId(profile?.clientId);
    if (!clientId) return;
    const current = profilesByClient.get(clientId);
    if (!current || profileRecency(profile) > profileRecency(current)) {
      profilesByClient.set(clientId, profile);
    }
  });
  return [...profilesByClient.values()];
}

function humanizeField(path) {
  const leaf = String(path || '').split('.').at(-1) || '';
  const labels = {
    PAYTERP68: 'Payter P68',
    DEFAULT: 'Other payment gateways',
    FULLPRICE: 'Full price option',
    INITIALPRICE: 'Initial price option',
    0: 'Line 1',
    1: 'Line 2',
    2: 'Line 3',
  };
  if (labels[leaf]) return labels[leaf];
  return leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function TextInput({ value, onChange, disabled = false, placeholder = '', type = 'text', inputMode, maxLength }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 disabled:bg-slate-100 disabled:text-slate-500"
    />
  );
}

function resolveColorHex(value) {
  const candidate = String(value || '').trim();
  const sixDigitHex = candidate.match(/^#([0-9a-f]{6})$/i);
  if (sixDigitHex) return `#${sixDigitHex[1].toUpperCase()}`;

  const threeDigitHex = candidate.match(/^#([0-9a-f]{3})$/i);
  if (threeDigitHex) {
    return `#${threeDigitHex[1].split('').map((character) => character.repeat(2)).join('').toUpperCase()}`;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined' || !window.CSS?.supports?.('color', candidate)) {
    return null;
  }

  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.fillStyle = candidate;
  const resolved = context.fillStyle;

  if (/^#[0-9a-f]{6}$/i.test(resolved)) return resolved.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(resolved)) {
    return `#${resolved.slice(1).split('').map((character) => character.repeat(2)).join('').toUpperCase()}`;
  }

  const rgb = resolved.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return `#${rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function ColorField({ label, description, value, onChange }) {
  const normalizedValue = resolveColorHex(value) || '#078B8C';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{label}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
        </div>
        <input
          type="color"
          value={normalizedValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-12 w-12 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
          aria-label={`${label} color picker`}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-lg border border-black/5" style={{ backgroundColor: normalizedValue }} />
        <TextInput
          value={value || ''}
          onChange={(nextValue) => onChange(resolveColorHex(nextValue) || String(nextValue).toUpperCase())}
        />
      </div>
    </div>
  );
}

function PreviewButton({ children, color, small = false, visible = true }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg px-3 text-center font-bold text-white shadow-sm ${visible ? 'visible' : 'invisible'} ${small ? 'min-h-9 text-[10px]' : 'min-h-14 text-sm'}`}
      style={{ backgroundColor: color }}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}

function ButtonControlPill({ label, enabled, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onToggle(!enabled)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${enabled
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
      title={`${enabled ? 'Disable' : 'Enable'} the ${label} button on the kiosk`}
    >
      <span className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {label}
      <span className="font-semibold opacity-75">{enabled ? 'On' : 'Off'}</span>
    </button>
  );
}

function useDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
  ));

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const updateViewport = (event) => setIsDesktop(event.matches);
    setIsDesktop(query.matches);
    query.addEventListener('change', updateViewport);
    return () => query.removeEventListener('change', updateViewport);
  }, []);

  return isDesktop;
}

function QrPlaceholder({ color }) {
  return (
    <div className="mx-auto grid h-24 w-24 grid-cols-4 gap-1 rounded-lg bg-white p-2 shadow-sm">
      {Array.from({ length: 16 }).map((_, index) => (
        <span key={index} className="rounded-[2px]" style={{ backgroundColor: [0, 1, 4, 5, 7, 10, 11, 14].includes(index) ? color : '#E2E8F0' }} />
      ))}
    </div>
  );
}

function PreviewCancelButton() {
  return <PreviewButton color="#DC2626" small>cancel</PreviewButton>;
}

function PreviewWarningGraphic() {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl bg-white p-3 shadow-sm">
      <ExclamationTriangleIcon className="h-24 w-24 text-red-600" />
    </div>
  );
}

function PreviewInstructionGraphic({ type }) {
  const Icon = type === 'charge' ? BoltIcon : ArrowRightOnRectangleIcon;
  return (
    <div className="flex min-h-24 items-center justify-center rounded-xl bg-white p-3 shadow-sm">
      <Icon className={`h-16 w-16 text-slate-900 ${type === 'return' ? 'rotate-180' : ''}`} strokeWidth={1.5} />
    </div>
  );
}

function KioskPreview({ profile, language, previewScreen, onPreviewScreenChange, onButtonToggle }) {
  const snapshot = resolveKioskUiSnapshot(profile);
  const copy = snapshot.languages?.locales?.[language] || {};
  const primary = snapshot.colors?.bcolor1 || snapshot.theme?.primary || DEFAULT_KIOSK_UI.colors.bcolor1;
  const secondary = snapshot.colors?.bcolor2 || snapshot.theme?.secondary || DEFAULT_KIOSK_UI.colors.bcolor2;
  const screens = copy.screens || {};
  const phone = snapshot.languages?.support?.phoneByMarket?.US || '';
  const supportText = `${copy.support?.helpPrefix || ''} ${phone}`.trim();
  const buttonVisibility = {
    language: snapshot.languages?.active !== false,
    map: snapshot.map?.active !== false,
    terms: snapshot.terms?.active !== false,
    information: snapshot.information?.active !== false,
    receipt: snapshot.receipt?.active !== false,
  };
  const previewButtonControls = PAGE_BUTTON_CONTROLS[previewScreen] || [];

  const content = (() => {
    switch (previewScreen) {
      case 'rentReturn':
        return <>
          <div className="rounded-xl bg-white p-5 text-center text-2xl font-extrabold shadow-sm">{screens.rentReturn?.question}</div>
          <PreviewButton color={primary}>{screens.rentReturn?.rentButton}</PreviewButton>
          <PreviewButton color={secondary}>{screens.rentReturn?.returnButton}</PreviewButton>
          <PreviewCancelButton />
        </>;
      case 'howItWorks':
        return <>
          {[
            ['rent', screens.howItWorks?.rentTitle, screens.howItWorks?.rentText],
            ['charge', screens.howItWorks?.chargeTitle, screens.howItWorks?.chargeText],
            ['return', screens.howItWorks?.returnTitle, screens.howItWorks?.returnText],
          ].map(([type, title, text]) => <div key={type} className="grid grid-cols-[2fr_1fr] gap-2"><div className="flex min-h-24 flex-col justify-center rounded-xl bg-white p-3 text-center shadow-sm"><div className="font-extrabold">{title}</div><hr className="my-2 border-0 border-t border-slate-400" /><div className="text-[11px] leading-4 text-slate-700">{text}</div></div><PreviewInstructionGraphic type={type} /></div>)}
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <PreviewCancelButton />
        </>;
      case 'returnInfo':
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-xl font-extrabold">{screens.returnInfo?.title}</div><hr className="my-3 border-0 border-t border-slate-400" /><div className="text-sm font-bold">{screens.returnInfo?.text}</div></div>
          <PreviewInstructionGraphic type="return" />
          <div className="rounded-xl bg-white p-4 text-center text-xs font-semibold shadow-sm">{screens.returnInfo?.confirmation}</div>
          <PreviewCancelButton />
        </>;
      case 'rentalComplete':
        return <>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-2xl font-extrabold">{screens.rentalComplete?.title}</div><hr className="my-3 border-0 border-t border-slate-400" /><div className="font-bold">{screens.rentalComplete?.text}</div></div>
          <PreviewInstructionGraphic type="rent" />
          <div className="rounded-xl bg-white p-4 text-center text-xs font-semibold leading-5 shadow-sm">{screens.rentalComplete?.detail}</div>
          <div className="grid grid-cols-2 gap-2"><PreviewButton color={secondary} small visible={buttonVisibility.receipt}><span className="inline-flex items-center gap-1"><CreditCardIcon className="h-4 w-4" />receipt</span></PreviewButton><PreviewCancelButton /></div>
        </>;
      case 'returnComplete':
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="flex min-h-72 flex-col rounded-xl bg-white px-4 py-3 text-center shadow-sm">
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="w-full">
                <CheckCircleIcon className="mx-auto h-28 w-28" style={{ color: primary }} />
                <hr className="my-5 w-full border-0 border-t border-slate-400" />
                <div className="text-2xl font-extrabold leading-tight">{screens.returnComplete?.returnText}</div>
                <div className="mt-1 text-2xl font-extrabold leading-tight">{screens.returnComplete?.thankYou}</div>
              </div>
            </div>
            <div className="w-full shrink-0 pb-1 pt-3 text-[10px] font-medium leading-[1.4]">
              {(screens.returnComplete?.depositNotice || []).map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
            </div>
          </div>
          <PreviewCancelButton />
        </>;
      case 'payment':
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="rounded-xl bg-white p-4 text-center text-lg font-extrabold shadow-sm">{copy.pricing?.payment?.instructionsByGateway?.PAYTERP68}</div>
          <div className="rounded-xl bg-white p-4 text-center text-xs font-bold leading-5 shadow-sm">
            <div>{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.first}</div>
            <div className="mt-2">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.additional}</div>
            <hr className="my-3 border-0 border-t-2 border-slate-400" />
            <div>{copy.pricing?.common?.integratedCables}</div>
            <div className="mt-1 text-[10px]">{copy.pricing?.common?.cableTypes}</div>
          </div>
          <div className="rounded-xl bg-white p-3 text-center text-[10px] font-bold leading-4 shadow-sm">{copy.pricing?.payment?.termsByGatewayOption?.INITIALPRICE?.map((term) => <div key={term}>{term}</div>)}</div>
          <PreviewCancelButton />
        </>;
      case 'wait':
        return <>
          <div className="flex min-h-52 items-center justify-center rounded-xl bg-white p-5 shadow-sm"><ArrowPathIcon className="h-28 w-28 animate-spin text-slate-300" /></div>
          <div className="rounded-xl bg-white p-5 text-center text-xl font-bold text-slate-500 shadow-sm">{screens.wait?.message}</div>
        </>;
      case 'receipt':
        return <>
          <div className="rounded-xl bg-white p-5 shadow-sm"><QrPlaceholder color={secondary} /></div>
          <div className="rounded-xl bg-white p-5 text-center text-xl font-extrabold shadow-sm">{screens.receipt?.message}</div>
          <PreviewCancelButton />
        </>;
      case 'terms':
        return <>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-lg font-extrabold">{screens.terms?.line1}</div><div className="mt-1 text-lg font-extrabold">{screens.terms?.line2}</div></div>
          <QrPlaceholder color={secondary} />
          <PreviewCancelButton />
        </>;
      case 'map':
        return <>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-xl font-extrabold">{screens.map?.title}</div><hr className="my-3 border-0 border-t border-slate-400" /><div className="space-y-1 text-sm font-bold"><div>{screens.map?.stationLocations}</div><div>{screens.map?.walkingDirections}</div><div>{screens.map?.liveAvailability}</div></div></div>
          <div className="flex min-h-36 items-center justify-center rounded-xl bg-white p-4 shadow-sm"><MapPinIcon className="h-16 w-16" style={{ color: secondary }} /></div>
          <PreviewCancelButton />
        </>;
      case 'error':
        return <>
          <div className="rounded-xl bg-white p-6 text-center text-xl font-extrabold shadow-sm">{screens.error?.message}</div>
          <PreviewWarningGraphic />
          <PreviewCancelButton />
        </>;
      case 'declined':
        return <>
          <div className="rounded-xl bg-white p-6 text-center text-xl font-extrabold shadow-sm">{screens.declined?.message}</div>
          <PreviewWarningGraphic />
          <PreviewCancelButton />
        </>;
      case 'outOfOrder':
        return <>
          <div className="rounded-xl bg-white p-6 text-center text-xl font-extrabold shadow-sm">{screens.outOfOrder?.message}</div>
          <PreviewWarningGraphic />
        </>;
      case 'start':
      default:
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm">
            <div className="font-extrabold">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.first}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.additional}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.notReturned}</div>
            <hr className="my-3 border-0 border-t-2 border-slate-400" />
            <div className="mt-3 text-xs font-semibold">{copy.pricing?.common?.integratedCables}</div>
            <div className="text-[10px] text-slate-500">{copy.pricing?.common?.cableTypes}</div>
          </div>
          <PreviewButton color={primary}>{screens.start?.startButton}</PreviewButton>
          <div className="grid grid-cols-4 gap-2">
            <PreviewButton color={secondary} small visible={buttonVisibility.language}>{screens.start?.languageButton}</PreviewButton>
            <PreviewButton color={secondary} small visible={buttonVisibility.map}>map</PreviewButton>
            <PreviewButton color={secondary} small visible={buttonVisibility.terms}>{screens.start?.termsButton}</PreviewButton>
            <PreviewButton color={secondary} small visible={buttonVisibility.information}>info</PreviewButton>
          </div>
        </>;
    }
  })();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Kiosk preview</h2>
          <p className="text-xs text-slate-500">Fixed layout · text and colors only</p>
        </div>
      </div>
      <select
        value={previewScreen}
        onChange={(event) => onPreviewScreenChange(event.target.value)}
        className="mb-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 outline-none"
      >
        {PREVIEW_SCREENS.map((screen) => <option key={screen.key} value={screen.key}>{screen.label}</option>)}
      </select>
      <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[22px] border-[7px] border-slate-900 bg-slate-100 shadow-xl">
        <div className="flex aspect-[600/1024] flex-col justify-center gap-3 overflow-hidden p-4 text-slate-900">
          {content}
        </div>
      </div>
      {previewButtonControls.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Buttons on this screen</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {previewButtonControls.map((control) => (
              <ButtonControlPill
                key={control.key}
                label={control.label}
                enabled={getNestedValue(snapshot, control.path, getNestedValue(DEFAULT_KIOSK_UI, control.path, true)) !== false}
                onToggle={(nextEnabled) => onButtonToggle(control.path, nextEnabled)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UiProfilesPage({
  onLogout,
  onNavigateToDashboard,
  onNavigateToAdmin,
  currentUser,
  allStationsData: suppliedStations = [],
  initialClientId = '',
  initialSection = '',
  previewMode = false,
  referenceTime,
  onCommand,
  t,
}) {
  const allStationsData = previewMode ? PROFILE_PREVIEW_KIOSKS : suppliedStations;
  const [previewApi] = useState(() => previewMode ? createProfilePreviewApi() : null);
  const profileRequest = useCallback((name, data) => previewMode ? previewApi(name, data) : callFunctionWithAuth(name, data), [previewMode, previewApi]);
  const draftCache = useRef(new Map());
  const [capabilities, setCapabilities] = useState({});
  const [deviceSection, setDeviceSection] = useState(initialSection);
  const [saving, setSaving] = useState(false);
  const [apolloTesting, setApolloTesting] = useState(false);
  const [apolloTestStationId, setApolloTestStationId] = useState('');
  const [apolloTestSession, setApolloTestSession] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [draftProfile, setDraftProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('Content');
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedSection, setSelectedSection] = useState('start');
  const [previewScreen, setPreviewScreen] = useState('start');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [publishingStationId, setPublishingStationId] = useState('');
  const [publishingAll, setPublishingAll] = useState(false);
  const [publishedAtOverrides, setPublishedAtOverrides] = useState({});
  const requestedProfileLoadKeysRef = useRef(new Set());
  const profileLoadSequenceRef = useRef(0);
  const isDesktopViewport = useDesktopViewport();

  const canUseUiEditor = currentUser?.isAdmin || currentUser?.username === 'chargerent' || currentUser?.features?.ui_editor === true || currentUser?.commands?.['client edit'] === true;
  const canLoadUiEditor = canUseUiEditor && isDesktopViewport;
  const isAdmin = currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const userClientId = normalizeClientId(currentUser?.clientId);

  const clientOptions = useMemo(() => {
    const clients = new Set();
    allStationsData.forEach((kiosk) => {
      const clientId = normalizeClientId(kiosk?.info?.client || kiosk?.info?.clientId);
      if (clientId) clients.add(clientId);
    });
    if (userClientId) clients.add(userClientId);
    return [...clients].sort();
  }, [allStationsData, userClientId]);

  const defaultProfileClientId = isAdmin ? (clientOptions[0] || '') : userClientId;
  const profileLoadKey = canUseUiEditor
    ? `${isAdmin ? 'admin' : 'client'}:${clientOptions.join(',') || defaultProfileClientId || 'default'}`
    : 'disabled';
  const visibleProfiles = useMemo(() => [...profiles]
    .filter((profile) => isAdmin || normalizeClientId(profile.clientId) === userClientId)
    .sort((a, b) => profileSortValue(a).localeCompare(profileSortValue(b))), [isAdmin, profiles, userClientId]);
  const profileClientId = normalizeClientId(draftProfile?.clientId || userClientId);
  const savedProfile = profiles.find(({id}) => id === selectedProfileId);
  const integratedKioskStationIds = useMemo(() => new Set(
    (Array.isArray(capabilities.integratedKioskStationIds) ? capabilities.integratedKioskStationIds : [])
      .map((stationId) => normalizeClientId(stationId)),
  ), [capabilities.integratedKioskStationIds]);
  const matchingKiosks = useMemo(() => allStationsData
    .filter((kiosk) => {
      const kioskClientId = normalizeClientId(kiosk?.info?.client || kiosk?.info?.clientId);
      return profileClientId ? kioskClientId === profileClientId : true;
    })
    .map((kiosk) => integratedKioskStationIds.has(normalizeClientId(kiosk.stationid || kiosk.stationId))
      ? {...kiosk, profileCapabilities: {...kiosk.profileCapabilities, chargerentApp: true}}
      : kiosk)
    .sort((a, b) => String(a.stationid || '').localeCompare(String(b.stationid || ''))), [allStationsData, integratedKioskStationIds, profileClientId]);

  const deviceSections = PROFILE_SECTIONS.filter(({key}) => (
    isProfileDeviceSectionAvailable(key, capabilities, matchingKiosks, savedProfile)
  ));
  const activeDevice = deviceSections.find(({key}) => key === deviceSection)?.key || deviceSections[0]?.key || '';
  const deviceLabel = deviceSections.find(({key}) => key === activeDevice)?.label || 'No compatible profile';
  const targetKiosks = activeDevice ? matchingKiosks.filter((kiosk) => isProfileSectionTarget(kiosk, activeDevice)) : [];
  const isTerminal = ['apollo', 'p68'].includes(activeDevice);
  const isClientWide = ['apollo', 'p68', 'chargerentApp'].includes(activeDevice);
  const busy = saving || publishingAll || Boolean(publishingStationId) || apolloTesting;
  const sectionAllowed = activeDevice !== 'apollo' || isAdmin;
  const apolloFlow = activeDevice === 'apollo' ? getTerminalProfileCopy(draftProfile, 'apollo').screenFlow : undefined;
  const apolloFlowError = getApolloScreenFlowError(apolloFlow);
  const screenServiceReady = apolloFlow === undefined || capabilities.apolloScreens === 1;
  const removalServiceReady = !apolloFlow?.removedEstablishedScreenIds?.length || capabilities.apolloEstablishedScreenRemoval === 1;
  const canSave = Boolean(activeDevice) && capabilities.scopedProfiles === 1 && screenServiceReady && removalServiceReady && !loading && sectionAllowed;
  const canPublish = canSave && activeDevice !== 'apollo' && !previewMode && targetKiosks.length > 0;
  const dirty = activeDevice
    ? JSON.stringify(profileSectionContent(draftProfile, activeDevice)) !== JSON.stringify(profileSectionContent(savedProfile, activeDevice))
    : false;
  const allowedApolloTestIds = new Set((Array.isArray(capabilities.apolloTestStationIds) ? capabilities.apolloTestStationIds : []).map((stationId) => String(stationId || '').trim().toUpperCase()));
  const apolloTestKiosks = activeDevice === 'apollo' ? targetKiosks.filter((kiosk) => allowedApolloTestIds.has(String(kiosk.stationid || '').trim().toUpperCase())) : [];
  const selectedApolloTestStationId = apolloTestKiosks.some((kiosk) => kiosk.stationid === apolloTestStationId) ? apolloTestStationId : '';
  const canTestApollo = capabilities.apolloTestScreens === 1
    && capabilities.apolloProfileTestsEnabled === true
    && Boolean(selectedApolloTestStationId)
    && Number(savedProfile?.version) > 0
    && savedProfile?.id === draftProfile?.id
    && !dirty
    && !apolloFlowError
    && Boolean(apolloFlow?.entryScreenId)
    && apolloTestSession?.status !== 'waiting'
    && !previewMode;

  useEffect(() => {
    if (draftProfile?.id) draftCache.current.set(draftProfile.id, draftProfile);
  }, [draftProfile]);

  const selectProfile = (id) => {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    setSelectedProfileId(id);
    setDraftProfile(cloneProfileValue(draftCache.current.get(id) || profile));
    setDeviceSection('');
    setApolloTestStationId('');
    setApolloTestSession(null);
    setSaveStatus(null);
  };

  const loadProfiles = useCallback(async () => {
    const sequence = ++profileLoadSequenceRef.current;
    setLoading(true);
    setSaveStatus(null);
    try {
      const payload = await profileRequest('uiProfile_list', {});
      if (sequence !== profileLoadSequenceRef.current) return;
      setCapabilities(payload?.capabilities || {});
      const loadedProfiles = oneProfilePerClient(Array.isArray(payload?.profiles) ? payload.profiles : []);
      const loadedClientIds = new Set(loadedProfiles.map((profile) => normalizeClientId(profile.clientId)));
      const testProfile = loadedProfiles.find((profile) => normalizeClientId(profile.clientId) === 'TEST');
      // Opening Profiles is read-only. Missing clients get an unsaved draft.
      const newDrafts = clientOptions.filter((clientId) => !loadedClientIds.has(clientId)).map((clientId) => ({
        ...createKioskUiProfileFromTemplate(clientId, testProfile), id: clientProfileDocumentId(clientId), version: 0,
      }));
      const nextProfiles = oneProfilePerClient([...loadedProfiles, ...newDrafts]).map((profile) => ({...profile, languages: normalizeKioskLanguages(profile.languages)}));
      setProfiles(nextProfiles);
      const preferredClient = initialClientId || (initialSection && allStationsData.find((kiosk) => isProfileSectionTarget(kiosk, initialSection))?.info?.client);
      const firstProfile = nextProfiles.find((profile) => profile.id === selectedProfileId)
        || nextProfiles.find((profile) => profile.clientId === normalizeClientId(preferredClient))
        || nextProfiles.find((profile) => profile.clientId === defaultProfileClientId) || nextProfiles[0];
      if (firstProfile) {
        setSelectedProfileId(firstProfile.id);
        setDraftProfile(cloneProfileValue(draftCache.current.get(firstProfile.id) || firstProfile));
      }
    } catch (error) {
      if (sequence === profileLoadSequenceRef.current) setSaveStatus({state: 'error', message: error?.message || 'Failed to load profiles.'});
    } finally {
      if (sequence === profileLoadSequenceRef.current) setLoading(false);
    }
  }, [clientOptions, defaultProfileClientId, profileRequest]);

  useEffect(() => {
    if (!canLoadUiEditor) {setLoading(false); return;}
    if (requestedProfileLoadKeysRef.current.has(profileLoadKey)) return;
    requestedProfileLoadKeysRef.current.add(profileLoadKey);
    loadProfiles();
  }, [canLoadUiEditor, loadProfiles, profileLoadKey]);

  useEffect(() => {
    if (previewMode || !apolloTestSession?.id || apolloTestSession.status !== 'waiting') return undefined;
    let canceled = false;
    const timer = window.setTimeout(async () => {
      try {
        const status = await profileRequest('apolloProfile_testStatus', {testId: apolloTestSession.id});
        if (canceled) return;
        setApolloTestSession(status);
        if (status.status === 'complete') setSaveStatus({state: 'success', message: `Apollo screen test completed on ${status.stationid}. No payment or vend was started.`});
        if (['error', 'expired'].includes(status.status)) setSaveStatus({state: 'error', message: status.error || `Apollo screen test ${status.status}.`});
      } catch (error) {
        if (!canceled) setSaveStatus({state: 'error', message: error?.message || 'Could not read the Apollo test status.'});
      }
    }, 2500);
    return () => {canceled = true; window.clearTimeout(timer);};
  }, [apolloTestSession, previewMode, profileRequest]);

  const updateUiColor = (key, value) => {
    setDraftProfile((previous) => {
      const nextUi = setNestedValue(previous?.ui || {}, `colors.${key}`, value);
      const themeKey = key === 'bcolor1' ? 'primary' : 'secondary';
      return { ...(previous || {}), ui: setNestedValue(nextUi, `theme.${themeKey}`, value) };
    });
  };
  const updateUiSetting = (path, value) => setDraftProfile((previous) => ({
    ...(previous || {}),
    ui: setNestedValue(previous?.ui || {}, path, value),
  }));
  const updateLanguageField = (locale, path, value) => setDraftProfile((previous) => ({
    ...(previous || {}),
    languages: setNestedValue(normalizeKioskLanguages(previous?.languages), `locales.${locale}.${path}`, value),
  }));
  const updateSupportPhone = (market, value) => setDraftProfile((previous) => ({
    ...(previous || {}),
    languages: setNestedValue(normalizeKioskLanguages(previous?.languages), `support.phoneByMarket.${market}`, value),
  }));
  const updateAdminPassword = (key, value) => setDraftProfile((previous) => ({
    ...(previous || {}),
    admin: {
      ...(previous?.admin || {}),
      [key]: String(value || '').replace(/[^1-5]/g, '').slice(0, 5),
    },
  }));

  const saveProfile = async () => {
    if (!draftProfile || !canSave || !activeDevice) return null;
    if (apolloFlowError) {setSaveStatus({state: 'error', message: apolloFlowError}); return null;}
    if (activeDevice === 'admin') {
      const invalid = Object.values(draftProfile.admin || {}).some((pin) => pin && !/^[1-5]{5}$/.test(String(pin)));
      if (invalid) {setSaveStatus({state: 'error', message: 'PINs must contain exactly five digits from 1 to 5.'}); return null;}
    }
    setSaving(true);
    try {
      const profileToSave = activeDevice === 'chargerentApp'
        ? writeChargerentAppProfile(draftProfile, normalizeChargerentAppProfile(readChargerentAppProfile(draftProfile)))
        : draftProfile;
      const payload = await profileRequest('uiProfile_upsert', {profile: profileToSave, section: activeDevice});
      const saved = payload?.profile;
      if (!saved) throw new Error('Profile save did not return a profile.');
      const normalized = {...saved, languages: normalizeKioskLanguages(saved.languages)};
      setProfiles((previous) => oneProfilePerClient([...previous.filter(({id}) => id !== saved.id), normalized]));
      // Retain unsaved edits in other sections.
      setDraftProfile((previous) => ({
        ...mergeProfileSection(previous, normalized, activeDevice),
        id: saved.id, version: saved.version, sectionVersions: saved.sectionVersions,
      }));
      setSaveStatus({state: 'success', message: `${deviceLabel} draft saved${previewMode ? ' in this preview' : ''}. No devices updated.`});
      return normalized;
    } catch (error) {
      setSaveStatus({state: 'error', message: error?.message || 'Failed to save profile.'});
      return null;
    } finally {setSaving(false);}
  };

  const publishProfile = async (stationId = '') => {
    if (!canPublish || busy) return;
    const targets = stationId ? targetKiosks.filter((kiosk) => kiosk.stationid === stationId) : targetKiosks;
    if (!targets.length) return;
    setPublishingStationId(stationId);
    setPublishingAll(!stationId);
    try {
      const saved = await saveProfile();
      if (!saved?.id) return;
      const payload = await profileRequest('uiProfile_apply', {profileId: saved.id, expectedVersion: saved.version, section: activeDevice, stationids: targets.map((kiosk) => kiosk.stationid)});
      const updated = Array.isArray(payload?.kiosks) ? payload.kiosks : [];
      if (updated.length !== targets.length || updated.some((kiosk) => !targets.some((target) => target.stationid === kiosk.stationid))) throw new Error('The server returned different targets. No device commands were sent.');
      if (activeDevice !== 'chargerentApp') {
        for (const kiosk of updated) {
          if (!onCommand) throw new Error('Profile saved on the server, but the kiosk command connection is unavailable.');
          await onCommand(kiosk.stationid, 'uichange', null, null, null, {kiosk, pushOnly: true, suppressCommandToast: true});
        }
      }
      setPublishedAtOverrides((previous) => ({...previous, ...Object.fromEntries(updated.map((kiosk) => [`${activeDevice}:${kiosk.stationid}`, kiosk.ui?.profileSections?.[activeDevice]?.appliedAt]))}));
      setSaveStatus({state: 'success', message: activeDevice === 'chargerentApp'
        ? `${deviceLabel} published for ${profileClientId}. ${updated.length} enrolled app${updated.length === 1 ? '' : 's'} will download it while connected.`
        : `${deviceLabel} update requested for ${updated.length} kiosk${updated.length === 1 ? '' : 's'}. Awaiting device confirmation.`});
    } catch (error) {
      setSaveStatus({state: 'error', message: error?.message || 'Could not publish profile.'});
    } finally {setPublishingStationId(''); setPublishingAll(false);}
  };

  const startApolloTest = async () => {
    if (!canTestApollo || apolloTesting) return;
    setApolloTesting(true);
    setApolloTestSession(null);
    try {
      const test = await profileRequest('apolloProfile_testStart', {
        profileId: savedProfile.id,
        expectedVersion: savedProfile.version,
        stationid: selectedApolloTestStationId,
        language: selectedLanguage,
      });
      setApolloTestSession(test);
      setSaveStatus({state: 'success', message: `Saved Apollo test screen sent to ${selectedApolloTestStationId}. Waiting for a terminal response.`});
    } catch (error) {
      setSaveStatus({state: 'error', message: error?.message || 'Could not start the Apollo screen test.'});
    } finally {
      setApolloTesting(false);
    }
  };

  const selectedSectionConfig = CONTENT_SECTIONS.find((section) => section.key === selectedSection) || CONTENT_SECTIONS[0];
  const localeValue = draftProfile?.languages?.locales?.[selectedLanguage] || {};
  const sectionValue = getNestedValue(localeValue, selectedSectionConfig.path, {});
  const copyFields = useMemo(() => {
    const fields = flattenLanguageFields(sectionValue).map((field) => ({
      ...field,
      path: field.path ? `${selectedSectionConfig.path}.${field.path}` : selectedSectionConfig.path,
      label: humanizeField(field.path || selectedSectionConfig.path),
    }));
    const query = searchQuery.trim().toLowerCase();
    return query ? fields.filter((field) => `${field.label} ${field.value}`.toLowerCase().includes(query)) : fields;
  }, [searchQuery, sectionValue, selectedSectionConfig.path]);

  if (!canUseUiEditor) {
    return <div className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">UI editor access is not enabled.</div></div>;
  }

  if (!isDesktopViewport) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <PaintBrushIcon className="mx-auto h-10 w-10 text-cyan-700" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">Desktop required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Client profiles are available on desktop screens.</p>
          <DashboardPageActions
            className="mt-5"
            onNavigateToDashboard={onNavigateToDashboard}
            onNavigateToAdmin={onNavigateToAdmin}
            onLogout={onLogout}
            t={t}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <CommandStatusToast status={saveStatus} onDismiss={() => setSaveStatus(null)} />
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Client profiles</h1>
          </div>
          <DashboardPageActions
            onNavigateToDashboard={onNavigateToDashboard}
            onNavigateToAdmin={onNavigateToAdmin}
            onLogout={onLogout}
            t={t}
          />
        </div>
      </header>

      <main className={`mx-auto grid max-w-[1600px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8 ${activeDevice === 'kiosk' ? 'xl:grid-cols-[240px_minmax(0,1fr)_340px]' : ''}`}>
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Client profiles</h2>
            </div>
            {loading ? <LoadingSpinner t={t} /> : visibleProfiles.length ? (
              <select
                value={selectedProfileId}
                disabled={busy} onChange={(event) => selectProfile(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                aria-label="Client profile"
              >
                {visibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name || profile.clientId}</option>
                ))}
              </select>
            ) : <p className="px-2 py-5 text-center text-sm text-slate-500">No client profiles available.</p>}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Matching kiosks</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{targetKiosks.length}</span>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {targetKiosks.map((kiosk) => {
                const online = isKioskOnline(kiosk, referenceTime);
                const lastPublishedAt = publishedAtOverrides[`${activeDevice}:${kiosk.stationid}`] || kiosk.ui?.profileSections?.[activeDevice]?.appliedAt || (activeDevice === 'kiosk' ? kiosk.ui?.profileAppliedAt : '');
                const isPublishing = publishingStationId === kiosk.stationid;
                return (
                  <div key={kiosk.stationid} className="rounded-xl border border-slate-100 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNavigateToDashboard(kiosk.stationid)}
                            className="truncate text-left text-sm font-semibold text-cyan-700 transition hover:text-cyan-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
                            title={`Show ${kiosk.stationid} on the dashboard`}
                          >
                            {kiosk.stationid}
                          </button>
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} title={online ? 'Online' : 'Offline'} />
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">{kiosk.info?.location || kiosk.info?.place || 'No location'}</span>
                      </span>
                      {!['apollo', 'chargerentApp'].includes(activeDevice) && <button
                        type="button"
                        onClick={() => publishProfile(kiosk.stationid)}
                        disabled={busy || !canPublish}
                        aria-label={`Publish ${deviceLabel} to ${kiosk.stationid}`}
                        className="shrink-0 rounded-lg bg-cyan-700 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {isPublishing ? 'Publishing…' : 'Publish'}
                      </button>}
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-600">{getProfileDeviceTypes(kiosk).map((type) => PROFILE_SECTIONS.find(({key}) => key === type).label).join(' · ') || 'Hardware not specified'}</p>
                    {isClientWide && <p className="mt-1 text-xs text-cyan-800">Client-wide profile</p>}
                    <p className="mt-1 text-xs text-slate-500">{profileDeviceStatus(kiosk, activeDevice, savedProfile, publishedAtOverrides[`${activeDevice}:${kiosk.stationid}`])}</p>
                    <p className="mt-2 text-[10px] font-medium text-slate-400">
                      Last published: {lastPublishedAt ? formatDateTime(lastPublishedAt) : 'Never'}
                    </p>
                  </div>
                );
              })}
              {!targetKiosks.length && <p className="px-2 py-5 text-center text-sm text-slate-500">No matching kiosks for this section.</p>}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="text-lg font-bold text-slate-900">{profileClientId || 'Loading profile'} <span className="text-sm font-normal text-slate-500">· {deviceLabel}</span></h2>
                <p className="mt-1 text-sm text-slate-500">{targetKiosks.length} matching kiosk{targetKiosks.length === 1 ? '' : 's'} · {dirty ? 'Unsaved changes' : 'No unsaved changes'}</p>
              </div>
              {activeDevice && <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveProfile} disabled={!canSave || busy || !dirty || Boolean(apolloFlowError)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save draft'}</button>
                <button type="button" onClick={() => publishProfile()} disabled={!canPublish || busy} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{publishingAll || publishingStationId ? 'Publishing…' : `Publish ${deviceLabel} (${targetKiosks.length})`}</button>
              </div>}
            </div>
            {deviceSections.length > 0 && <nav className="mt-5 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" aria-label="Profile device sections">
              {deviceSections.map(({key, label}) => <button type="button" key={key} aria-pressed={activeDevice === key} disabled={busy} onClick={() => {setDeviceSection(key); setApolloTestStationId(''); setApolloTestSession(null); setSaveStatus(null);}} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${activeDevice === key ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
            </nav>}
            {previewMode && <p className="mt-4 rounded-lg bg-cyan-50 px-3 py-2 text-sm text-cyan-900">Local preview · sample kiosks. Saves stay in this preview; publishing is disabled.</p>}
            {!loading && activeDevice && !canSave && <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{!sectionAllowed ? 'Apollo editing requires administrator access.' : 'Preview available. Saving and publishing require the updated profile service.'}</p>}
            {activeDevice === 'apollo' && <p className="mt-3 text-sm text-slate-500">This is one client-wide flow for every matching Apollo kiosk. Publishing stays unavailable until the terminal connection is validated.</p>}
            {activeDevice === 'chargerentApp' && <p className="mt-3 text-sm text-slate-500">This client-wide app profile controls the integrated Chargerent media and Stripe UI. Reader provisioning, pricing, and payment processing remain separate.</p>}
            {activeDevice === 'apollo' && <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-cyan-950">Test an added screen on one terminal</h3>
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-cyan-900">This sends only the saved added-screen sequence. It does not start the established rent, payment, return, or vend flow; Continue and Start end the test session.</p>
                </div>
                {apolloTestSession && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-900">{apolloTestSession.status}</span>}
              </div>
              {capabilities.apolloTestScreens !== 1 ? <p className="mt-3 text-xs font-semibold text-amber-800">Deploy the Apollo test service before a physical terminal can be selected.</p>
                : capabilities.apolloProfileTestsEnabled !== true ? <p className="mt-3 text-xs font-semibold text-amber-800">Physical testing is locked in the backend. Enable it only with an explicit test-kiosk allowlist.</p>
                  : <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="min-w-56 flex-1 text-xs font-bold text-cyan-950">Allowlisted test kiosk
                      <select aria-label="Apollo test kiosk" value={selectedApolloTestStationId} disabled={busy} onChange={(event) => {setApolloTestStationId(event.target.value); setApolloTestSession(null);}} className="mt-1.5 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                        <option value="">Choose one kiosk</option>
                        {apolloTestKiosks.map((kiosk) => <option key={kiosk.stationid} value={kiosk.stationid}>{kiosk.stationid} · {kiosk.info?.location || kiosk.info?.place || 'No location'}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={startApolloTest} disabled={!canTestApollo || busy} className="rounded-xl bg-cyan-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{apolloTesting ? 'Sending test…' : 'Send saved test'}</button>
                  </div>}
              {capabilities.apolloProfileTestsEnabled === true && !apolloTestKiosks.length && <p className="mt-3 text-xs font-semibold text-amber-800">No Apollo kiosk for this client is on the backend test allowlist.</p>}
              {capabilities.apolloProfileTestsEnabled === true && dirty && <p className="mt-2 text-xs text-cyan-900">Save this Apollo draft before testing so the terminal receives the reviewed version.</p>}
              {capabilities.apolloProfileTestsEnabled === true && !dirty && !apolloFlow?.entryScreenId && <p className="mt-2 text-xs text-cyan-900">Add a screen and select it under After Start, show before testing.</p>}
            </div>}
            {activeDevice === 'kiosk' && <div className="mt-5 flex gap-1 border-t border-slate-100 pt-3">
              {EDITOR_TABS.map((tab) => <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab.key ? 'bg-cyan-50 text-cyan-800' : 'text-slate-500'}`}>{tab.label}</button>)}
            </div>}
          </div>
          <fieldset disabled={busy || !sectionAllowed || loading} className="min-w-0 p-4 sm:p-5">
            {!loading && !activeDevice && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <h2 className="font-bold text-slate-900">No compatible profile sections</h2>
              <p className="mt-2 text-sm text-slate-500">This client has no kiosks that match the available kiosk, Chargerent app, Apollo, P68, or Kiosk access rules.</p>
            </div>}
            {activeDevice === 'chargerentApp' && draftProfile && (() => {
              const appProfile = readChargerentAppProfile(draftProfile);
              const updateAppProfile = (value) => setDraftProfile((previous) => writeChargerentAppProfile(previous, value));
              return <div>
                <div className="mb-5 rounded-xl border border-cyan-100 bg-cyan-50 p-4">
                  <h2 className="text-lg font-bold text-cyan-950">Chargerent integrated app</h2>
                  <p className="mt-1 text-sm leading-6 text-cyan-900">Configure the client-facing checkout presentation here. Campaign Manager turns checkout on or off and assigns media to kiosks.</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-cyan-200 bg-white p-3 text-sm text-slate-700">
                      <span className="font-semibold">Checkout visibility</span>
                      <p className="mt-1 text-xs leading-5 text-slate-500">Use the Checkout toggle in Campaign Manager. This profile supplies the checkout design and sizing.</p>
                    </div>
                    <label className="rounded-xl border border-cyan-200 bg-white p-3 text-sm font-semibold text-slate-700">
                      <span>Expanded panel height · {Math.round(appProfile.checkout.height * 100)}%</span>
                      <input type="range" min="10" max="50" step="1" value={Math.round(appProfile.checkout.height * 100)} onChange={(event) => updateAppProfile({...appProfile, checkout: {...appProfile.checkout, height: Number(event.target.value) / 100}})} className="mt-3 w-full accent-cyan-700" />
                    </label>
                  </div>
                </div>
                <StripeProfileEditor value={appProfile.stripeUi} checkout={appProfile.checkout} previewStations={targetKiosks.map((kiosk) => String(kiosk.stationid || kiosk.stationId || '').trim().toUpperCase())} onChange={(stripeUi) => updateAppProfile({...appProfile, stripeUi})} disabled={busy || !sectionAllowed} />
              </div>;
            })()}
            {isTerminal && draftProfile && <TerminalProfileEditor profile={draftProfile} section={activeDevice} language={selectedLanguage} onLanguageChange={setSelectedLanguage} onChange={setDraftProfile} disabled={busy || !sectionAllowed} allowEstablishedScreenRemoval={capabilities.apolloEstablishedScreenRemoval === 1} />}
            {activeDevice === 'kiosk' && activeTab === 'Content' && <div>
              <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-lg font-bold">Localized kiosk text</h2>
                  <p className="mt-1 text-sm text-slate-500">Edit the words shown in the fixed kiosk screens. Variables such as <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{'{amount}'}</code> are filled by the kiosk.</p>
                </div>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {KIOSK_PROFILE_LANGUAGES.map((language) => <button key={language.key} onClick={() => setSelectedLanguage(language.key)} className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedLanguage === language.key ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500'}`}>{language.label}</button>)}
                </div>
              </div>
              <div className="grid gap-5 md:grid-cols-[190px_minmax(0,1fr)]">
                <nav className="max-h-[670px] space-y-1 overflow-y-auto pr-1">
                  {CONTENT_SECTIONS.map((section) => <button key={section.key} type="button" onClick={() => { const nextPreviewScreen = SECTION_PREVIEW_SCREEN[section.key] || section.key; setSelectedSection(section.key); if (PREVIEW_SCREENS.some((screen) => screen.key === nextPreviewScreen)) setPreviewScreen(nextPreviewScreen); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === section.key ? 'bg-cyan-50 text-cyan-800' : 'text-slate-600 hover:bg-slate-50'}`}><span>{section.label}</span>{selectedSection === section.key && <ChevronRightIcon className="h-4 w-4" />}</button>)}
                </nav>
                <div className="min-w-0">
                  <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div><h3 className="font-bold text-slate-900">{LANGUAGE_LABELS[selectedLanguage]} · {selectedSectionConfig.label}</h3><p className="text-xs text-slate-500">{copyFields.length} editable field{copyFields.length === 1 ? '' : 's'}</p></div>
                    <div className="relative"><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find text" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-cyan-500 sm:w-44" /></div>
                  </div>
                  <div className="space-y-4">
                    {copyFields.map((field) => <Field key={field.path} label={field.label}>
                      <textarea
                        value={getNestedValue(localeValue, field.path, '')}
                        onChange={(event) => updateLanguageField(selectedLanguage, field.path, event.target.value)}
                        rows={String(field.value).length > 100 ? 4 : String(field.value).length > 45 ? 3 : 2}
                        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                      />
                    </Field>)}
                    {!copyFields.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No matching text fields.</div>}
                  </div>
                </div>
              </div>
            </div>}

            {activeDevice === 'kiosk' && activeTab === 'Colors' && <div>
              <div className="mb-5"><h2 className="flex items-center gap-2 text-lg font-bold"><PaintBrushIcon className="h-5 w-5 text-cyan-700" />Brand colors</h2><p className="mt-1 text-sm text-slate-500">These are the only visual values profiles can change. Screen positions, sizes, spacing, and layout stay locked to the kiosk flow.</p></div>
              <div className="grid gap-4 md:grid-cols-2">
                <ColorField label="Primary action" description="Start, rent, and main action buttons." value={draftProfile?.ui?.colors?.bcolor1 || DEFAULT_KIOSK_UI.colors.bcolor1} onChange={(value) => updateUiColor('bcolor1', value)} />
                <ColorField label="Secondary action" description="Map, terms, language, return, and information buttons." value={draftProfile?.ui?.colors?.bcolor2 || DEFAULT_KIOSK_UI.colors.bcolor2} onChange={(value) => updateUiColor('bcolor2', value)} />
              </div>
              <div className="mt-6"><h3 className="font-bold text-slate-900">Support phone numbers</h3><p className="mt-1 text-sm text-slate-500">The kiosk chooses the number for its configured market.</p><div className="mt-4 grid gap-4 md:grid-cols-3">{[['US', 'United States'], ['CAN', 'Canada'], ['EUR', 'Europe']].map(([market, label]) => <Field key={market} label={label}><TextInput value={draftProfile?.languages?.support?.phoneByMarket?.[market] || ''} onChange={(value) => updateSupportPhone(market, value)} /></Field>)}</div></div>
            </div>}

            {activeDevice === 'admin' && <div>
              <div className="mb-5">
                <h2 className="flex items-center gap-2 text-lg font-bold"><LockClosedIcon className="h-5 w-5 text-cyan-700" />Kiosk admin access</h2>
                <p className="mt-1 text-sm text-slate-500">These PINs control kiosk administration. Publish Kiosk access to update them separately from screen content.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="User PIN" hint="Exactly five digits using only 1, 2, 3, 4, or 5.">
                  <TextInput type="password" inputMode="numeric" maxLength={5} value={draftProfile?.admin?.userpassword || ''} onChange={(value) => updateAdminPassword('userpassword', value)} placeholder="Enter user PIN" />
                </Field>
                <Field label="Admin PIN" hint="Exactly five digits using only 1, 2, 3, 4, or 5.">
                  <TextInput type="password" inputMode="numeric" maxLength={5} value={draftProfile?.admin?.adminpassword || ''} onChange={(value) => updateAdminPassword('adminpassword', value)} placeholder="Enter admin PIN" />
                </Field>
              </div>
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">Leave a PIN blank to preserve the current kiosk value. Once saved in the profile, the PIN remains available here as a masked value.</div>
            </div>}

          </fieldset>
        </section>

        {activeDevice === 'kiosk' && <aside className="space-y-4 lg:col-start-2 xl:col-start-auto">
          <div className="xl:sticky xl:top-24"><KioskPreview profile={draftProfile} language={selectedLanguage} previewScreen={previewScreen} onPreviewScreenChange={setPreviewScreen} onButtonToggle={(path, value) => !busy && updateUiSetting(path, value)} /></div>
        </aside>}
      </main>
    </div>
  );
}
