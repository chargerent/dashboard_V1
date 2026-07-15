import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightOnRectangleIcon,
  ChevronRightIcon,
  HomeIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
} from '@heroicons/react/24/outline';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { isKioskOnline } from '../utils/helpers.js';
import {
  DEFAULT_KIOSK_UI,
  KIOSK_PROFILE_LANGUAGES,
  cloneProfileValue,
  createDefaultKioskUiProfile,
  flattenLanguageFields,
  getNestedValue,
  normalizeKioskLanguages,
  resolveKioskUiSnapshot,
  setNestedValue,
} from '../utils/kioskUiProfiles.js';

const EDITOR_TABS = [
  { key: 'Content', label: 'Text' },
  { key: 'Colors', label: 'Colors' },
  { key: 'Admin', label: 'Admin' },
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
  { key: 'terminal', label: 'Payment terminal', path: 'terminals.PAYTERP68' },
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
  { key: 'returnInfo', label: 'Return' },
  { key: 'rentalComplete', label: 'Complete' },
  { key: 'terms', label: 'Terms' },
  { key: 'error', label: 'Error' },
];

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
          <div className="rounded-xl bg-white p-5 text-center text-xl font-extrabold shadow-sm">{screens.rentReturn?.question}</div>
          <PreviewButton color={primary}>{screens.rentReturn?.rentButton}</PreviewButton>
          <PreviewButton color={secondary}>{screens.rentReturn?.returnButton}</PreviewButton>
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'howItWorks':
        return <>
          {[
            [screens.howItWorks?.rentTitle, screens.howItWorks?.rentText],
            [screens.howItWorks?.chargeTitle, screens.howItWorks?.chargeText],
            [screens.howItWorks?.returnTitle, screens.howItWorks?.returnText],
          ].map(([title, text]) => <div key={title} className="rounded-xl bg-white p-3 text-center shadow-sm"><div className="font-extrabold">{title}</div><div className="mt-1 text-[11px] leading-4 text-slate-600">{text}</div></div>)}
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'returnInfo':
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-xl font-extrabold">{screens.returnInfo?.title}</div><div className="mt-3 text-sm font-semibold">{screens.returnInfo?.text}</div></div>
          <div className="rounded-xl bg-white p-4 text-center text-xs font-semibold shadow-sm">{screens.returnInfo?.confirmation}</div>
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'rentalComplete':
        return <>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-2xl font-extrabold">{screens.rentalComplete?.title}</div><div className="mt-3 font-bold">{screens.rentalComplete?.text}</div></div>
          <div className="rounded-xl bg-white p-4 text-center text-xs font-semibold leading-5 shadow-sm">{screens.rentalComplete?.detail}</div>
          <PreviewButton color={secondary} small visible={buttonVisibility.receipt}>receipt</PreviewButton>
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'terms':
        return <>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm"><div className="text-lg font-extrabold">{screens.terms?.line1}</div><div className="mt-2 text-sm font-bold">{screens.terms?.line2}</div></div>
          <QrPlaceholder color={secondary} />
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'error':
        return <>
          <div className="rounded-xl bg-white p-6 text-center text-xl font-extrabold shadow-sm">{screens.error?.message}</div>
          <PreviewButton color="#DC2626" small>cancel</PreviewButton>
        </>;
      case 'start':
      default:
        return <>
          <div className="text-center text-[10px] font-semibold text-slate-600">{supportText}</div>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm">
            <div className="font-extrabold">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.first}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600">{copy.pricing?.plans?.LEASE_SIMPLE_DAILY?.additional}</div>
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
  allStationsData = [],
  referenceTime,
  onCommand,
  t,
}) {
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
  const requestedProfileLoadKeysRef = useRef(new Set());
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
  const matchingKiosks = useMemo(() => allStationsData
    .filter((kiosk) => {
      const kioskClientId = normalizeClientId(kiosk?.info?.client || kiosk?.info?.clientId);
      return profileClientId ? kioskClientId === profileClientId : true;
    })
    .sort((a, b) => String(a.stationid || '').localeCompare(String(b.stationid || ''))), [allStationsData, profileClientId]);

  const loadProfiles = useCallback(async (preferredProfileId = '') => {
    setLoading(true);
    setSaveStatus(null);
    try {
      const payload = await callFunctionWithAuth('uiProfile_list', {});
      const loadedProfiles = oneProfilePerClient(Array.isArray(payload?.profiles) ? payload.profiles : []);
      const loadedClientIds = new Set(loadedProfiles.map((profile) => normalizeClientId(profile.clientId)));
      const missingClientIds = clientOptions.filter((clientId) => !loadedClientIds.has(clientId));
      const createdProfiles = [];

      for (const clientId of missingClientIds) {
        const defaultProfile = {
          ...createDefaultKioskUiProfile(clientId),
          id: clientProfileDocumentId(clientId),
        };
        const createPayload = await callFunctionWithAuth('uiProfile_upsert', { profile: defaultProfile });
        if (createPayload?.profile) createdProfiles.push(createPayload.profile);
      }

      const nextProfiles = oneProfilePerClient([...loadedProfiles, ...createdProfiles]);
      setProfiles(nextProfiles);
      const firstProfile = nextProfiles.find((profile) => profile.id === preferredProfileId)
        || nextProfiles.find((profile) => normalizeClientId(profile.clientId) === defaultProfileClientId)
        || nextProfiles[0]
        || createDefaultKioskUiProfile(defaultProfileClientId);
      setSelectedProfileId(firstProfile.id || '');
      setDraftProfile({ ...cloneProfileValue(firstProfile), languages: normalizeKioskLanguages(firstProfile.languages) });
    } catch (error) {
      const isMissingEndpoint = error?.status === 404 && error?.functionName === 'uiProfile_list';
      if (!isMissingEndpoint) console.error(error);
      setSaveStatus({
        state: 'error',
        message: isMissingEndpoint
          ? 'UI profile backend is not deployed yet. Deploy the Firebase UI profile functions, then refresh this page.'
          : error?.message || 'Failed to load UI profiles.',
      });
      setDraftProfile(createDefaultKioskUiProfile(defaultProfileClientId));
    } finally {
      setLoading(false);
    }
  }, [clientOptions, defaultProfileClientId]);

  useEffect(() => {
    if (!canLoadUiEditor) {
      setLoading(false);
      return;
    }
    if (requestedProfileLoadKeysRef.current.has(profileLoadKey)) return;
    requestedProfileLoadKeysRef.current.add(profileLoadKey);
    loadProfiles();
  }, [canLoadUiEditor, loadProfiles, profileLoadKey]);

  useEffect(() => {
    const profile = visibleProfiles.find((candidate) => candidate.id === selectedProfileId);
    if (!profile) return;
    setDraftProfile({ ...cloneProfileValue(profile), languages: normalizeKioskLanguages(profile.languages) });
  }, [selectedProfileId, visibleProfiles]);

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

  const saveProfile = async (statusOverride = null) => {
    if (!draftProfile) return null;
    const configuredPins = [
      ['User PIN', draftProfile?.admin?.userpassword],
      ['Admin PIN', draftProfile?.admin?.adminpassword],
    ];
    const invalidPin = configuredPins.find(([, pin]) => pin && !/^[1-5]{5}$/.test(String(pin)));
    if (invalidPin) {
      setSaveStatus({ state: 'error', message: `${invalidPin[0]} must contain exactly five digits from 1 to 5.` });
      return null;
    }
    setSaveStatus({ state: 'sending', message: 'Saving UI profile…' });
    const clientId = normalizeClientId(draftProfile.clientId || userClientId);
    const nextProfile = {
      ...draftProfile,
      id: draftProfile.id || clientProfileDocumentId(clientId),
      name: `${clientId} Kiosk UI`,
      clientId,
      status: statusOverride || draftProfile.status || 'draft',
      languages: normalizeKioskLanguages(draftProfile.languages),
    };
    try {
      const payload = await callFunctionWithAuth('uiProfile_upsert', { profile: nextProfile });
      const savedProfile = payload?.profile;
      if (!savedProfile) throw new Error('Profile save did not return a profile.');
      setProfiles((previous) => oneProfilePerClient([
        ...previous.filter((profile) => normalizeClientId(profile.clientId) !== normalizeClientId(savedProfile.clientId)),
        savedProfile,
      ]));
      setSelectedProfileId(savedProfile.id);
      setDraftProfile({ ...cloneProfileValue(savedProfile), languages: normalizeKioskLanguages(savedProfile.languages) });
      setSaveStatus({ state: 'success', message: statusOverride === 'published' ? 'Profile published.' : 'Profile saved.' });
      return savedProfile;
    } catch (error) {
      console.error(error);
      setSaveStatus({ state: 'error', message: error?.message || 'Failed to save UI profile.' });
      return null;
    }
  };

  const applyProfile = async () => {
    const profileToApply = await saveProfile('published');
    if (!profileToApply?.id) return;
    const stationids = matchingKiosks.map((kiosk) => kiosk.stationid).filter(Boolean);
    if (!stationids.length) {
      setSaveStatus({ state: 'success', message: 'Profile published. No kiosks are assigned to this client yet.' });
      return;
    }
    setSaveStatus({ state: 'sending', message: 'Applying UI profile…' });
    try {
      const payload = await callFunctionWithAuth('uiProfile_apply', { profileId: profileToApply.id, stationids });
      const updatedKiosks = Array.isArray(payload?.kiosks) ? payload.kiosks : [];
      for (const kiosk of updatedKiosks) {
        await onCommand?.(kiosk.stationid, 'uichange', null, null, null, { kiosk, pushOnly: true });
      }
      const count = payload?.updatedCount || updatedKiosks.length;
      setSaveStatus({ state: 'success', message: `Applied to ${count} kiosk${count === 1 ? '' : 's'}.` });
      await loadProfiles(profileToApply.id);
    } catch (error) {
      console.error(error);
      setSaveStatus({ state: 'error', message: error?.message || 'Failed to apply UI profile.' });
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
          <p className="mt-2 text-sm leading-6 text-slate-500">Kiosk UI Profiles are available only on desktop screens.</p>
          <button type="button" onClick={onNavigateToDashboard} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            <HomeIcon className="h-5 w-5" />
            Back to dashboard
          </button>
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
            <h1 className="text-2xl font-bold text-gray-900">Kiosk UI</h1>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onNavigateToDashboard} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
              <HomeIcon className="h-6 w-6" />
            </button>
            <button type="button" onClick={onNavigateToAdmin} className="rounded-md bg-orange-100 p-2 text-orange-700 hover:bg-orange-200" title={t('admin_tools')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
            <button type="button" onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title={t('logout')}>
              <ArrowRightOnRectangleIcon className="h-6 w-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8 xl:grid-cols-[240px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Client profiles</h2>
            </div>
            {loading ? <LoadingSpinner t={t} /> : visibleProfiles.length ? (
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                aria-label="Client profile"
              >
                {visibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.clientId}</option>
                ))}
              </select>
            ) : <p className="px-2 py-5 text-center text-sm text-slate-500">No client profiles available.</p>}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Assigned kiosks</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{matchingKiosks.length}</span>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {matchingKiosks.map((kiosk) => {
                const online = isKioskOnline(kiosk, referenceTime);
                return (
                  <div key={kiosk.stationid} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{kiosk.stationid}</span>
                      <span className="block truncate text-[11px] text-slate-500">{kiosk.info?.location || kiosk.info?.place || 'No location'}</span>
                    </span>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} title={online ? 'Online' : 'Offline'} />
                  </div>
                );
              })}
              {!matchingKiosks.length && <p className="px-2 py-5 text-center text-sm text-slate-500">No kiosks found for this client.</p>}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Profile settings</h2>
                <p className="mt-1 text-sm text-slate-500"><span className="font-semibold text-slate-700">{profileClientId}</span> · Publishing updates all {matchingKiosks.length} kiosk{matchingKiosks.length === 1 ? '' : 's'} assigned to this client.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => saveProfile('draft')} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">Save draft</button>
                <button type="button" onClick={applyProfile} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">Publish</button>
              </div>
            </div>
            <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
              {EDITOR_TABS.map((tab) => <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`min-w-max flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{tab.label}</button>)}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {activeTab === 'Content' && <div>
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
                  {CONTENT_SECTIONS.map((section) => <button key={section.key} type="button" onClick={() => { setSelectedSection(section.key); if (PREVIEW_SCREENS.some((screen) => screen.key === section.key)) setPreviewScreen(section.key); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === section.key ? 'bg-cyan-50 text-cyan-800' : 'text-slate-600 hover:bg-slate-50'}`}><span>{section.label}</span>{selectedSection === section.key && <ChevronRightIcon className="h-4 w-4" />}</button>)}
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

            {activeTab === 'Colors' && <div>
              <div className="mb-5"><h2 className="flex items-center gap-2 text-lg font-bold"><PaintBrushIcon className="h-5 w-5 text-cyan-700" />Brand colors</h2><p className="mt-1 text-sm text-slate-500">These are the only visual values profiles can change. Screen positions, sizes, spacing, and layout stay locked to the kiosk flow.</p></div>
              <div className="grid gap-4 md:grid-cols-2">
                <ColorField label="Primary action" description="Start, rent, and main action buttons." value={draftProfile?.ui?.colors?.bcolor1 || DEFAULT_KIOSK_UI.colors.bcolor1} onChange={(value) => updateUiColor('bcolor1', value)} />
                <ColorField label="Secondary action" description="Map, terms, language, return, and information buttons." value={draftProfile?.ui?.colors?.bcolor2 || DEFAULT_KIOSK_UI.colors.bcolor2} onChange={(value) => updateUiColor('bcolor2', value)} />
              </div>
              <div className="mt-6"><h3 className="font-bold text-slate-900">Support phone numbers</h3><p className="mt-1 text-sm text-slate-500">The kiosk chooses the number for its configured market.</p><div className="mt-4 grid gap-4 md:grid-cols-3">{[['US', 'United States'], ['CAN', 'Canada'], ['EUR', 'Europe']].map(([market, label]) => <Field key={market} label={label}><TextInput value={draftProfile?.languages?.support?.phoneByMarket?.[market] || ''} onChange={(value) => updateSupportPhone(market, value)} /></Field>)}</div></div>
            </div>}

            {activeTab === 'Admin' && <div>
              <div className="mb-5">
                <h2 className="flex items-center gap-2 text-lg font-bold"><LockClosedIcon className="h-5 w-5 text-cyan-700" />Kiosk admin access</h2>
                <p className="mt-1 text-sm text-slate-500">These five-digit PINs update on every kiosk assigned to the client when this profile is published.</p>
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

          </div>
        </section>

        <aside className="space-y-4 lg:col-start-2 xl:col-start-auto">
          <div className="xl:sticky xl:top-24"><KioskPreview profile={draftProfile} language={selectedLanguage} previewScreen={previewScreen} onPreviewScreenChange={setPreviewScreen} onButtonToggle={updateUiSetting} /></div>
        </aside>
      </main>
    </div>
  );
}
