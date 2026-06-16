import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  PaintBrushIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { isKioskOnline } from '../utils/helpers.js';
import {
  DEFAULT_KIOSK_UI,
  KIOSK_PROFILE_LANGUAGES,
  KIOSK_PROFILE_SCREENS,
  cloneProfileValue,
  createDefaultKioskUiProfile,
  flattenLanguageFields,
  getNestedValue,
  resolveKioskUiSnapshot,
  setNestedValue,
} from '../utils/kioskUiProfiles.js';

const TAB_OPTIONS = ['Theme', 'Screens', 'Copy', 'Assign'];
const STATUS_OPTIONS = ['draft', 'published', 'archived'];
const LANGUAGE_LABELS = Object.fromEntries(KIOSK_PROFILE_LANGUAGES.map((language) => [language.key, language.label]));
const SCREEN_SIZE_OPTIONS = [
  { value: '600x1024', label: '600 x 1024 portrait (1024 x 600 rotated)' },
  { value: '1080x1920', label: '1080 x 1920 portrait (1920 x 1080 rotated)' },
  { value: '1024x600', label: '1024 x 600 landscape' },
  { value: '1920x1080', label: '1920 x 1080 landscape' },
];

function normalizeClientId(value) {
  return String(value || '').trim().toUpperCase();
}

function profileSortValue(profile) {
  return `${normalizeClientId(profile.clientId)}:${String(profile.name || '').toLowerCase()}`;
}

function ProfileField({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, type = 'text', disabled = false }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
    />
  );
}

function SelectInput({ value, options, onChange, disabled = false }) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
    >
      {options.map((option) => (
        <option key={option.value ?? option} value={option.value ?? option}>
          {option.label ?? option}
        </option>
      ))}
    </select>
  );
}

function ColorInput({ label, value, onChange }) {
  return (
    <ProfileField label={label}>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value || '#ffffff'}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-12 rounded border border-gray-300 bg-white p-1"
        />
        <TextInput value={value || ''} onChange={(nextValue) => onChange(String(nextValue).toUpperCase())} />
      </div>
    </ProfileField>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
        aria-label={label}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-5' : 'left-1'}`} />
      </button>
    </div>
  );
}

const PREVIEW_SCREEN_OPTIONS = [
  { key: 'startpage', label: 'Start' },
  { key: 'rentpage', label: 'Rent' },
  { key: 'workspage', label: 'Info' },
  { key: 'returninfopage', label: 'Return' },
  { key: 'paymentpage', label: 'Payment' },
  { key: 'waitpage', label: 'Wait' },
  { key: 'thankyoupage', label: 'Thanks' },
  { key: 'receiptpage', label: 'Receipt' },
  { key: 'termspage', label: 'Terms' },
  { key: 'mappage', label: 'Map' },
  { key: 'errorpage', label: 'Error' },
  { key: 'declinedpage', label: 'Declined' },
  { key: 'ooopage', label: 'Out' },
];

function resolvePreviewLanguage(defaultLanguage) {
  return {
    ENGLISH: 'en',
    FRENCH: 'fr',
    SPANISH: 'es',
  }[String(defaultLanguage || '').toUpperCase()] || 'en';
}

function pricingLines(copy) {
  const pricing = copy?.startpage?.pricing?.leasesimpledaily || {};
  return [
    pricing.one,
    pricing.two,
    `${pricing.three || ''} ${pricing.four || ''}`.trim(),
    pricing.five,
    pricing.six,
  ].filter(Boolean);
}

function QrPlaceholder({ theme }) {
  return (
    <div className="mx-auto grid h-28 w-28 grid-cols-4 gap-1 rounded bg-white p-2 shadow-inner">
      {Array.from({ length: 16 }).map((_, index) => (
        <span
          key={index}
          className="rounded-sm"
          style={{ backgroundColor: [0, 1, 4, 5, 10, 11, 14].includes(index) ? theme.secondary : '#E5E7EB' }}
        />
      ))}
    </div>
  );
}

function PreviewBlock({ children, theme, layout, className = '', style = {} }) {
  return (
    <div
      className={`w-full rounded-lg px-3 py-3 shadow-sm ${className}`}
      style={{
        backgroundColor: theme.surface,
        borderRadius: Number(layout.buttonRadius || 8),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PreviewButton({ children, onClick, theme, layout, tone = 'primary', className = '', style = {} }) {
  const backgroundColor = tone === 'secondary' ? theme.secondary : tone === 'danger' ? theme.danger : theme.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-4 py-3 text-sm font-bold shadow-sm transition hover:brightness-95 active:scale-[0.99] ${className}`}
      style={{
        backgroundColor,
        color: theme.buttonText,
        borderRadius: Number(layout.buttonRadius || 8),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function KioskPreview({ profile }) {
  const [previewScreen, setPreviewScreen] = useState('startpage');
  const [languageOpen, setLanguageOpen] = useState(false);
  const snapshot = resolveKioskUiSnapshot(profile);
  const [languageKey, setLanguageKey] = useState(resolvePreviewLanguage(snapshot.defaultlanguage));
  const copy = snapshot.languages?.[languageKey] || {};
  const theme = snapshot.theme || DEFAULT_KIOSK_UI.theme;
  const layout = snapshot.layout || DEFAULT_KIOSK_UI.layout;
  const viewport = snapshot.viewport || DEFAULT_KIOSK_UI.viewport;
  const fontScale = Number(layout.fontScale || 1);
  const placement = String(layout.textPlacement || 'middle').toLowerCase();
  const alignItems = placement === 'top' ? 'flex-start' : placement === 'bottom' ? 'flex-end' : 'center';
  const screenTextAlign = layout.textAlign || 'center';
  const viewportWidth = Math.max(240, Number(viewport.width || DEFAULT_KIOSK_UI.viewport.width));
  const viewportHeight = Math.max(320, Number(viewport.height || DEFAULT_KIOSK_UI.viewport.height));
  const dashboardColumns = Math.max(1, Number(viewport.dashboardColumns || DEFAULT_KIOSK_UI.viewport.dashboardColumns));
  const rowHeight = Math.max(24, Number(viewport.dashboardRowHeight || DEFAULT_KIOSK_UI.viewport.dashboardRowHeight));
  const dashboardGap = Math.max(0, Number(viewport.dashboardGap ?? DEFAULT_KIOSK_UI.viewport.dashboardGap));
  const previewScale = Math.min(1, 380 / viewportWidth, 680 / viewportHeight);
  const scaledWidth = Math.round(viewportWidth * previewScale);
  const scaledHeight = Math.round(viewportHeight * previewScale);
  const nodeStyle = (widthUnits = dashboardColumns, heightUnits = 1) => ({
    width: `${Math.min(dashboardColumns, Number(widthUnits) || dashboardColumns) / dashboardColumns * 100}%`,
    height: Math.max(rowHeight * (Number(heightUnits) || 1), rowHeight),
    marginLeft: 'auto',
    marginRight: 'auto',
  });
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${dashboardColumns}, minmax(0, 1fr))`,
    gap: dashboardGap,
  };
  const helpText = copy.hiw?.help || 'Need help? Please call: +33 805 088 812';
  const startCopy = copy.startpage || {};
  const rentCopy = copy.rentpage || {};
  const returnCopy = copy.returnpage || {};
  const waitText = typeof copy.wait === 'string' ? copy.wait : 'please wait...';
  const mapCopy = copy.mapspage || {};

  useEffect(() => {
    setLanguageKey(resolvePreviewLanguage(snapshot.defaultlanguage));
  }, [snapshot.defaultlanguage]);

  const goToScreen = (screen) => {
    setLanguageOpen(false);
    setPreviewScreen(screen);
  };

  const renderCancel = (widthUnits = 10) => (
    <PreviewButton theme={theme} layout={layout} tone="secondary" style={nodeStyle(widthUnits, 1)} onClick={() => goToScreen('startpage')}>
      cancel
    </PreviewButton>
  );

  const renderScreen = () => {
    switch (previewScreen) {
      case 'rentpage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 3)}>
              <div className="text-2xl font-extrabold leading-tight" style={{ fontSize: `${28 * fontScale}px` }}>
                {rentCopy.infotext || 'What would you like to do?'}
              </div>
            </PreviewBlock>
            <PreviewButton theme={theme} layout={layout} style={nodeStyle(10, 2)} onClick={() => goToScreen('paymentpage')}>
              {rentCopy.rentbutton || 'Rent'}
            </PreviewButton>
            <PreviewButton theme={theme} layout={layout} tone="secondary" style={nodeStyle(10, 2)} onClick={() => goToScreen('returninfopage')}>
              {rentCopy.returnbutton || 'Return'}
            </PreviewButton>
            {renderCancel(10)}
          </>
        );
      case 'workspage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(8, 4)}>
              <div className="text-xl font-extrabold">{copy.hiw?.renttitle || 'To rent'}</div>
              <div className="mt-1 text-sm">{copy.hiw?.renttext || 'Use your payment card or your smartphone to pay and receive a charger'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(8, 4)}>
              <div className="text-xl font-extrabold">{copy.hiw?.chargetitle || 'To charge'}</div>
              <div className="mt-1 text-sm">{copy.hiw?.chargetext || 'Connect the charger to your device using the built-in cables'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(8, 4)}>
              <div className="text-xl font-extrabold">{copy.hiw?.returntitle || 'To return'}</div>
              <div className="mt-1 text-sm">{copy.hiw?.returntext || 'Find any Chargerent kiosk insert the charger in a slot'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} className="text-xs font-semibold shadow-none" style={nodeStyle(12, 2)}>
              {helpText}
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'returninfopage':
        return (
          <>
            <div className="text-xs font-semibold" style={{ color: theme.text, ...nodeStyle(14, 1) }}>{helpText}</div>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 5)}>
              <div className="text-2xl font-extrabold leading-tight">{returnCopy.returntitle || 'To return charger'}</div>
              <div className="mt-2 text-base font-semibold">{returnCopy.returntext || 'insert the charger into a slot and wait for confirmation'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 3)}>
              <div className="text-sm font-semibold">{returnCopy.confirmationtext || 'If you do not receive a confirmation slightly push on the returned charger'}</div>
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'paymentpage':
        return (
          <>
            <div className="text-xs font-semibold" style={{ color: theme.text, ...nodeStyle(14, 1) }}>{helpText}</div>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 3)}>
              <div className="text-2xl font-extrabold leading-tight">{copy.paymentpage?.text || 'To pay please use your credit card'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 6)}>
              {pricingLines(copy).map((line) => (
                <div key={line} className="text-sm font-semibold">{line}</div>
              ))}
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 3)}>
              <div className="text-sm font-semibold">{copy.paymentpage?.payterms || 'You accept to pay all rental fees for more info please review our terms'}</div>
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'waitpage':
        return (
          <div className="flex min-h-[340px] w-full flex-col items-center justify-center gap-5">
            <div
              className="h-16 w-16 animate-spin rounded-full border-4 border-gray-200"
              style={{ borderTopColor: theme.primary }}
            />
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 3)}>
              <div className="text-2xl font-extrabold">{waitText}</div>
            </PreviewBlock>
          </div>
        );
      case 'thankyoupage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 5)}>
              <div className="text-3xl font-extrabold">{copy.thankyoupage?.thankyoutitle || 'Thank you !'}</div>
              <div className="mt-2 text-lg font-bold">{copy.thankyoupage?.thankyoutext || 'Please take charger from slot'}</div>
            </PreviewBlock>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 3)}>
              <div className="text-sm font-semibold">{copy.thankyoupage?.thankyoutext2 || 'Connect the cable to your device charging will start automatically return the charger to any of our locations'}</div>
            </PreviewBlock>
            <PreviewButton theme={theme} layout={layout} style={nodeStyle(6, 1)} onClick={() => goToScreen('receiptpage')}>
              receipt
            </PreviewButton>
            {renderCancel(6)}
          </>
        );
      case 'receiptpage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(8, 3)}>
              <div className="text-2xl font-extrabold">{copy.receiptpage?.text || 'For your receipt please scan this QR Code'}</div>
            </PreviewBlock>
            <QrPlaceholder theme={theme} />
            {renderCancel(10)}
          </>
        );
      case 'termspage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 3)}>
              <div className="text-2xl font-extrabold">{copy.termspage?.text1 || 'For our rental terms and conditions'}</div>
              <div className="mt-2 text-lg font-bold">{copy.termspage?.text2 || 'Please scan this QR code'}</div>
            </PreviewBlock>
            <QrPlaceholder theme={theme} />
            {renderCancel(10)}
          </>
        );
      case 'mappage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 5)}>
              <div className="text-2xl font-extrabold">{mapCopy.title || 'Scan the QR code for'}</div>
              <div className="mt-2 text-base font-semibold">{mapCopy.text || 'Station locations'}</div>
              <div className="text-base font-semibold">{mapCopy.text1 || mapCopy.text2 || 'Walking directions'}</div>
              <div className="text-base font-semibold">{mapCopy.text3 || mapCopy.text2 || 'Live availability'}</div>
            </PreviewBlock>
            <QrPlaceholder theme={theme} />
            {renderCancel(10)}
          </>
        );
      case 'returntypage':
        return (
          <>
            <div className="text-xs font-semibold" style={{ color: theme.text, ...nodeStyle(14, 1) }}>{helpText}</div>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 5)}>
              <div className="text-3xl font-extrabold">{copy.returntypage?.return || 'Return complete'}</div>
              <div className="mt-2 text-3xl font-extrabold">{copy.returntypage?.ty || 'Thank you!'}</div>
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'declinedpage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 6)}>
              <div className="text-2xl font-extrabold">{copy.declinedpage?.text || 'Declined card, Please try again'}</div>
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'ooopage':
        return (
          <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 6)}>
            <div className="text-3xl font-extrabold">{copy.ooopage?.text || 'Out of order'}</div>
          </PreviewBlock>
        );
      case 'errorpage':
        return (
          <>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(12, 6)}>
              <div className="text-2xl font-extrabold">{copy.errorpage?.text || 'Transaction error, Please try again'}</div>
            </PreviewBlock>
            {renderCancel(12)}
          </>
        );
      case 'startpage':
      default:
        return (
          <>
            <div className="text-xs font-semibold" style={{ color: theme.text, ...nodeStyle(14, 1) }}>{helpText}</div>
            <PreviewBlock theme={theme} layout={layout} style={nodeStyle(14, 8)}>
              {pricingLines(copy).map((line) => (
                <div key={line} className="text-sm font-bold">{line}</div>
              ))}
            </PreviewBlock>
            <PreviewButton theme={theme} layout={layout} style={nodeStyle(10, 2)} onClick={() => goToScreen('rentpage')}>
              {startCopy.startbutton || 'Start'}
            </PreviewButton>
            <div className="w-full" style={gridStyle}>
              <PreviewButton theme={theme} layout={layout} tone="secondary" className="px-2 py-2 text-xs" style={{ gridColumn: 'span 4', height: rowHeight }} onClick={() => setLanguageOpen((open) => !open)}>
                {startCopy.languagebutton || copy.language || 'english'}
              </PreviewButton>
              <PreviewButton theme={theme} layout={layout} tone="secondary" className="px-2 py-2 text-xs" style={{ gridColumn: 'span 3', height: rowHeight }} onClick={() => goToScreen('mappage')}>
                map
              </PreviewButton>
              <PreviewButton theme={theme} layout={layout} tone="secondary" className="px-2 py-2 text-xs" style={{ gridColumn: 'span 4', height: rowHeight }} onClick={() => goToScreen('termspage')}>
                {startCopy.termsbutton || 'terms'}
              </PreviewButton>
              <PreviewButton theme={theme} layout={layout} tone="secondary" className="px-2 py-2 text-xs" style={{ gridColumn: 'span 3', height: rowHeight }} onClick={() => goToScreen('workspage')}>
                info
              </PreviewButton>
            </div>
            {languageOpen && (
              <div className="w-full" style={gridStyle}>
                {KIOSK_PROFILE_LANGUAGES.map((language) => (
                  <PreviewButton
                    key={language.key}
                    theme={theme}
                    layout={layout}
                    tone={language.key === languageKey ? 'primary' : 'secondary'}
                    className="px-2 py-2 text-xs"
                    style={{ gridColumn: 'span 4', height: rowHeight }}
                    onClick={() => {
                      setLanguageKey(language.key);
                      setLanguageOpen(false);
                    }}
                  >
                    {snapshot.languages?.[language.key]?.language || language.label}
                  </PreviewButton>
                ))}
                <PreviewButton theme={theme} layout={layout} tone="secondary" className="px-2 py-2 text-xs" style={{ gridColumn: 'span 2', height: rowHeight }} onClick={() => goToScreen('loginpage')}>
                  admin
                </PreviewButton>
              </div>
            )}
          </>
        );
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PREVIEW_SCREEN_OPTIONS.map((screen) => (
          <button
            key={screen.key}
            type="button"
            onClick={() => goToScreen(screen.key)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              previewScreen === screen.key
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            }`}
          >
            {screen.label}
          </button>
        ))}
      </div>
      <div className="mb-2 text-center text-xs font-semibold text-gray-600">
        {viewportWidth} x {viewportHeight}px · {Math.round(previewScale * 100)}%
      </div>
      <div
        className="mx-auto overflow-hidden rounded-lg border border-gray-300 bg-black shadow-sm"
        style={{ width: scaledWidth, height: scaledHeight }}
      >
        <div
          className="flex flex-col overflow-hidden"
          style={{
            width: viewportWidth,
            height: viewportHeight,
            padding: dashboardGap,
            boxSizing: 'border-box',
            backgroundColor: theme.background,
            color: theme.text,
            transform: `scale(${previewScale})`,
            transformOrigin: 'top left',
            justifyContent: alignItems,
            textAlign: screenTextAlign,
            fontSize: `${14 * fontScale}px`,
            gap: dashboardGap,
          }}
        >
          {previewScreen === 'loginpage' ? (
            <>
              <PreviewBlock theme={theme} layout={layout}>
                <div className="text-2xl font-extrabold">Enter PIN</div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'enter'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="rounded-md px-2 py-2 text-xs font-bold"
                      style={{ backgroundColor: theme.secondary, color: theme.buttonText }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </PreviewBlock>
              {renderCancel()}
            </>
          ) : renderScreen()}
        </div>
      </div>
    </div>
  );
}

export default function UiProfilesPage({
  onLogout,
  onNavigateToAdmin,
  currentUser,
  allStationsData = [],
  onCommand,
  t,
}) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [draftProfile, setDraftProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('Theme');
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedScreen, setSelectedScreen] = useState('startpage');
  const [selectedStationIds, setSelectedStationIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const requestedProfileLoadKeysRef = useRef(new Set());

  const canUseUiEditor = currentUser?.isAdmin || currentUser?.username === 'chargerent' || currentUser?.features?.ui_editor === true || currentUser?.commands?.['client edit'] === true;
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
  const profileLoadKey = canUseUiEditor ? `${isAdmin ? 'admin' : 'client'}:${defaultProfileClientId || 'default'}` : 'disabled';

  const visibleProfiles = useMemo(() => (
    [...profiles]
      .filter((profile) => isAdmin || normalizeClientId(profile.clientId) === userClientId)
      .sort((a, b) => profileSortValue(a).localeCompare(profileSortValue(b)))
  ), [isAdmin, profiles, userClientId]);

  const profileClientId = normalizeClientId(draftProfile?.clientId || userClientId);
  const matchingKiosks = useMemo(() => (
    allStationsData
      .filter((kiosk) => {
        const kioskClientId = normalizeClientId(kiosk?.info?.client || kiosk?.info?.clientId);
        return profileClientId ? kioskClientId === profileClientId : true;
      })
      .sort((a, b) => String(a.stationid || '').localeCompare(String(b.stationid || '')))
  ), [allStationsData, profileClientId]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setSaveStatus(null);
    try {
      const payload = await callFunctionWithAuth('uiProfile_list', {});
      const nextProfiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
      setProfiles(nextProfiles);
      const firstProfile = nextProfiles[0] || createDefaultKioskUiProfile(defaultProfileClientId);
      setSelectedProfileId(firstProfile.id || '');
      setDraftProfile(cloneProfileValue(firstProfile));
    } catch (error) {
      const isMissingUiProfileEndpoint = error?.status === 404 && error?.functionName === 'uiProfile_list';
      if (!isMissingUiProfileEndpoint) {
        console.error(error);
      }
      setSaveStatus({
        state: 'error',
        message: isMissingUiProfileEndpoint
          ? 'UI profile backend is not deployed yet. Deploy the Firebase UI profile functions, then refresh this page.'
          : error?.message || 'Failed to load UI profiles.',
      });
      const fallback = createDefaultKioskUiProfile(defaultProfileClientId);
      setDraftProfile(fallback);
    } finally {
      setLoading(false);
    }
  }, [defaultProfileClientId]);

  useEffect(() => {
    if (canUseUiEditor) {
      if (requestedProfileLoadKeysRef.current.has(profileLoadKey)) {
        return;
      }
      requestedProfileLoadKeysRef.current.add(profileLoadKey);
      loadProfiles();
    } else {
      setLoading(false);
    }
  }, [canUseUiEditor, loadProfiles, profileLoadKey]);

  useEffect(() => {
    const profile = visibleProfiles.find((candidate) => candidate.id === selectedProfileId);
    if (profile) {
      setDraftProfile(cloneProfileValue(profile));
      const assignedStations = allStationsData
        .filter((kiosk) => kiosk?.ui?.profileId === profile.id)
        .map((kiosk) => kiosk.stationid);
      setSelectedStationIds(assignedStations);
    }
  }, [allStationsData, selectedProfileId, visibleProfiles]);

  const updateProfileField = (path, value) => {
    setDraftProfile((previous) => setNestedValue(previous || {}, path, value));
  };

  const updateUiField = (path, value) => {
    setDraftProfile((previous) => ({
      ...(previous || {}),
      ui: setNestedValue(previous?.ui || {}, path, value),
    }));
  };

  const updateLanguageField = (language, path, value) => {
    setDraftProfile((previous) => ({
      ...(previous || {}),
      languages: {
        ...(previous?.languages || {}),
        [language]: setNestedValue(previous?.languages?.[language] || {}, path, value),
      },
    }));
  };

  const createProfile = () => {
    const clientId = isAdmin ? (clientOptions[0] || '') : userClientId;
    const next = createDefaultKioskUiProfile(clientId);
    setSelectedProfileId('');
    setDraftProfile(next);
    setSelectedStationIds([]);
    setActiveTab('Theme');
  };

  const saveProfile = async (statusOverride = null) => {
    if (!draftProfile) return null;

    setSaveStatus({ state: 'sending', message: 'Saving UI profile...' });
    const nextProfile = {
      ...draftProfile,
      clientId: normalizeClientId(draftProfile.clientId || userClientId),
      status: statusOverride || draftProfile.status || 'draft',
    };

    try {
      const payload = await callFunctionWithAuth('uiProfile_upsert', { profile: nextProfile });
      const savedProfile = payload?.profile;
      if (!savedProfile) throw new Error('Profile save did not return a profile.');

      setProfiles((previous) => {
        const withoutSaved = previous.filter((profile) => profile.id !== savedProfile.id);
        return [...withoutSaved, savedProfile];
      });
      setSelectedProfileId(savedProfile.id);
      setDraftProfile(cloneProfileValue(savedProfile));
      setSaveStatus({ state: 'success', message: statusOverride === 'published' ? 'Profile published.' : 'Profile saved.' });
      return savedProfile;
    } catch (error) {
      console.error(error);
      setSaveStatus({ state: 'error', message: error?.message || 'Failed to save UI profile.' });
      return null;
    }
  };

  const deleteProfile = async () => {
    if (!draftProfile?.id) {
      createProfile();
      return;
    }

    setSaveStatus({ state: 'sending', message: 'Deleting UI profile...' });
    try {
      await callFunctionWithAuth('uiProfile_delete', { profileId: draftProfile.id });
      const remaining = profiles.filter((profile) => profile.id !== draftProfile.id);
      setProfiles(remaining);
      const nextProfile = remaining[0] || createDefaultKioskUiProfile(isAdmin ? clientOptions[0] : userClientId);
      setSelectedProfileId(nextProfile.id || '');
      setDraftProfile(cloneProfileValue(nextProfile));
      setSaveStatus({ state: 'success', message: 'Profile deleted.' });
    } catch (error) {
      console.error(error);
      setSaveStatus({ state: 'error', message: error?.message || 'Failed to delete UI profile.' });
    }
  };

  const toggleStation = (stationid) => {
    setSelectedStationIds((previous) => (
      previous.includes(stationid)
        ? previous.filter((id) => id !== stationid)
        : [...previous, stationid]
    ));
  };

  const applyProfile = async () => {
    const profileToApply = await saveProfile('published');
    if (!profileToApply?.id || selectedStationIds.length === 0) return;

    setSaveStatus({ state: 'sending', message: 'Applying UI profile...' });
    try {
      const payload = await callFunctionWithAuth('uiProfile_apply', {
        profileId: profileToApply.id,
        stationids: selectedStationIds,
      });
      const updatedKiosks = Array.isArray(payload?.kiosks) ? payload.kiosks : [];

      for (const kiosk of updatedKiosks) {
        await onCommand?.(kiosk.stationid, 'uichange', null, null, null, {
          kiosk,
          pushOnly: true,
        });
      }

      setSaveStatus({
        state: 'success',
        message: `Applied to ${payload?.updatedCount || updatedKiosks.length} kiosk${(payload?.updatedCount || updatedKiosks.length) === 1 ? '' : 's'}.`,
      });
      await loadProfiles();
    } catch (error) {
      console.error(error);
      setSaveStatus({ state: 'error', message: error?.message || 'Failed to apply UI profile.' });
    }
  };

  const copyFields = useMemo(() => {
    const languageValue = draftProfile?.languages?.[selectedLanguage] || {};
    const screenValue = getNestedValue(languageValue, selectedScreen, {});
    if (typeof screenValue === 'string') {
      return [{ path: selectedScreen, label: KIOSK_PROFILE_SCREENS.find((screen) => screen.key === selectedScreen)?.label || selectedScreen, value: screenValue }];
    }

    return flattenLanguageFields(screenValue).map((field) => ({
      ...field,
      path: `${selectedScreen}.${field.path}`,
      label: field.path.replace(/\./g, ' / '),
    }));
  }, [draftProfile?.languages, selectedLanguage, selectedScreen]);

  if (!canUseUiEditor) {
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <button onClick={onNavigateToAdmin} className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
              Back
            </button>
            <button onClick={onLogout} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
              {t('logout')}
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">UI editor access is not enabled.</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <CommandStatusToast status={saveStatus} onDismiss={() => setSaveStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={onNavigateToAdmin} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to admin">
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Kiosk UI Profiles</h1>
              <p className="text-sm text-gray-500">{draftProfile?.clientId || userClientId || 'All clients'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => saveProfile()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Save
            </button>
            <button onClick={() => saveProfile('published')} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Publish
            </button>
            <button onClick={onLogout} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:px-8">
        <aside className="space-y-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-gray-500">Profiles</h2>
              <button onClick={createProfile} className="rounded-md bg-blue-50 p-2 text-blue-700 hover:bg-blue-100" title="New profile">
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
            {loading ? (
              <LoadingSpinner t={t} />
            ) : (
              <div className="space-y-2">
                {visibleProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      selectedProfileId === profile.id
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block font-semibold">{profile.name}</span>
                    <span className="text-xs text-gray-500">{profile.clientId || 'Global'} · {profile.status || 'draft'} · v{profile.version || 1}</span>
                  </button>
                ))}
                {!visibleProfiles.length && <p className="text-sm text-gray-500">No profiles yet.</p>}
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-lg bg-white shadow-sm">
          <div className="border-b border-gray-200 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <ProfileField label="Profile Name">
                <TextInput value={draftProfile?.name || ''} onChange={(value) => updateProfileField('name', value)} />
              </ProfileField>
              <ProfileField label="Client">
                <SelectInput
                  value={profileClientId}
                  disabled={!isAdmin}
                  onChange={(value) => updateProfileField('clientId', normalizeClientId(value))}
                  options={(clientOptions.length ? clientOptions : [profileClientId || '']).filter(Boolean).map((clientId) => ({ value: clientId, label: clientId }))}
                />
              </ProfileField>
              <ProfileField label="Status">
                <SelectInput
                  value={draftProfile?.status || 'draft'}
                  onChange={(value) => updateProfileField('status', value)}
                  options={STATUS_OPTIONS}
                />
              </ProfileField>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {TAB_OPTIONS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-md px-4 py-2 text-sm font-semibold ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            {activeTab === 'Theme' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900"><PaintBrushIcon className="h-5 w-5" /> Colors</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ColorInput label="Primary" value={draftProfile?.ui?.theme?.primary} onChange={(value) => {
                      updateUiField('theme.primary', value);
                      updateUiField('colors.bcolor1', value);
                    }} />
                    <ColorInput label="Secondary" value={draftProfile?.ui?.theme?.secondary} onChange={(value) => {
                      updateUiField('theme.secondary', value);
                      updateUiField('colors.bcolor2', value);
                    }} />
                    <ColorInput label="Background" value={draftProfile?.ui?.theme?.background} onChange={(value) => updateUiField('theme.background', value)} />
                    <ColorInput label="Surface" value={draftProfile?.ui?.theme?.surface} onChange={(value) => updateUiField('theme.surface', value)} />
                    <ColorInput label="Text" value={draftProfile?.ui?.theme?.text} onChange={(value) => updateUiField('theme.text', value)} />
                    <ColorInput label="Danger" value={draftProfile?.ui?.theme?.danger} onChange={(value) => updateUiField('theme.danger', value)} />
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-base font-semibold text-gray-900">Layout</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ProfileField label="Default Language">
                      <SelectInput
                        value={draftProfile?.ui?.defaultlanguage || 'ENGLISH'}
                        onChange={(value) => updateUiField('defaultlanguage', value)}
                        options={[
                          { value: 'ENGLISH', label: 'English' },
                          { value: 'FRENCH', label: 'French' },
                          { value: 'SPANISH', label: 'Spanish' },
                        ]}
                      />
                    </ProfileField>
                    <ProfileField label="Mode">
                      <SelectInput value={draftProfile?.ui?.mode || 'UI'} onChange={(value) => updateUiField('mode', value)} options={['UI', 'MEDIA']} />
                    </ProfileField>
                    <ProfileField label="Kiosk Screen Size">
                      <SelectInput
                        value={`${draftProfile?.ui?.viewport?.width || DEFAULT_KIOSK_UI.viewport.width}x${draftProfile?.ui?.viewport?.height || DEFAULT_KIOSK_UI.viewport.height}`}
                        onChange={(value) => {
                          const [width, height] = String(value).split('x').map((part) => Number(part));
                          updateUiField('viewport.width', width);
                          updateUiField('viewport.height', height);
                          updateUiField('viewport.orientation', height >= width ? 'portrait' : 'landscape');
                          updateUiField('viewport.sourceResolution', value === '600x1024' ? '1024x600' : value === '1080x1920' ? '1920x1080' : value);
                        }}
                        options={SCREEN_SIZE_OPTIONS}
                      />
                    </ProfileField>
                    <ProfileField label="Viewport Width Px">
                      <TextInput type="number" value={draftProfile?.ui?.viewport?.width ?? DEFAULT_KIOSK_UI.viewport.width} onChange={(value) => updateUiField('viewport.width', Math.max(240, Number(value) || DEFAULT_KIOSK_UI.viewport.width))} />
                    </ProfileField>
                    <ProfileField label="Viewport Height Px">
                      <TextInput type="number" value={draftProfile?.ui?.viewport?.height ?? DEFAULT_KIOSK_UI.viewport.height} onChange={(value) => updateUiField('viewport.height', Math.max(320, Number(value) || DEFAULT_KIOSK_UI.viewport.height))} />
                    </ProfileField>
                    <ProfileField label="Dashboard Columns">
                      <TextInput type="number" value={draftProfile?.ui?.viewport?.dashboardColumns ?? DEFAULT_KIOSK_UI.viewport.dashboardColumns} onChange={(value) => updateUiField('viewport.dashboardColumns', Math.max(1, Number(value) || DEFAULT_KIOSK_UI.viewport.dashboardColumns))} />
                    </ProfileField>
                    <ProfileField label="Dashboard Row Height">
                      <TextInput type="number" value={draftProfile?.ui?.viewport?.dashboardRowHeight ?? DEFAULT_KIOSK_UI.viewport.dashboardRowHeight} onChange={(value) => updateUiField('viewport.dashboardRowHeight', Math.max(24, Number(value) || DEFAULT_KIOSK_UI.viewport.dashboardRowHeight))} />
                    </ProfileField>
                    <ProfileField label="Dashboard Gap">
                      <TextInput type="number" value={draftProfile?.ui?.viewport?.dashboardGap ?? DEFAULT_KIOSK_UI.viewport.dashboardGap} onChange={(value) => updateUiField('viewport.dashboardGap', Math.max(0, Number(value) || 0))} />
                    </ProfileField>
                    <ProfileField label="Text Placement">
                      <SelectInput value={draftProfile?.ui?.layout?.textPlacement || 'middle'} onChange={(value) => updateUiField('layout.textPlacement', value)} options={['top', 'middle', 'bottom']} />
                    </ProfileField>
                    <ProfileField label="Text Align">
                      <SelectInput value={draftProfile?.ui?.layout?.textAlign || 'center'} onChange={(value) => updateUiField('layout.textAlign', value)} options={['left', 'center', 'right']} />
                    </ProfileField>
                    <ProfileField label="Font Scale">
                      <TextInput type="number" value={draftProfile?.ui?.layout?.fontScale ?? 1} onChange={(value) => updateUiField('layout.fontScale', Math.min(1.5, Math.max(0.75, Number(value) || 1)))} />
                    </ProfileField>
                    <ProfileField label="Button Radius">
                      <TextInput type="number" value={draftProfile?.ui?.layout?.buttonRadius ?? 8} onChange={(value) => updateUiField('layout.buttonRadius', Math.min(30, Math.max(0, Number(value) || 0)))} />
                    </ProfileField>
                    <ProfileField label="Idle Time Seconds">
                      <TextInput type="number" value={draftProfile?.ui?.idletime ?? 20} onChange={(value) => updateUiField('idletime', Math.max(5, Number(value) || 20))} />
                    </ProfileField>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'Screens' && (
              <div className="grid gap-3 md:grid-cols-2">
                {Object.keys(DEFAULT_KIOSK_UI.screens).map((screenKey) => (
                  <div key={screenKey} className="rounded-md border border-gray-200 p-3">
                    <ToggleRow label={screenKey.replace(/page$/, ' page')} checked={draftProfile?.ui?.screens?.[screenKey]?.enabled !== false} onChange={(value) => updateUiField(`screens.${screenKey}.enabled`, value)} />
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <ProfileField label="Placement">
                        <SelectInput value={draftProfile?.ui?.screens?.[screenKey]?.textPlacement || draftProfile?.ui?.layout?.textPlacement || 'middle'} onChange={(value) => updateUiField(`screens.${screenKey}.textPlacement`, value)} options={['top', 'middle', 'bottom']} />
                      </ProfileField>
                      <ProfileField label="Align">
                        <SelectInput value={draftProfile?.ui?.screens?.[screenKey]?.textAlign || draftProfile?.ui?.layout?.textAlign || 'center'} onChange={(value) => updateUiField(`screens.${screenKey}.textAlign`, value)} options={['left', 'center', 'right']} />
                      </ProfileField>
                    </div>
                  </div>
                ))}
                <ToggleRow label="Language Buttons" checked={draftProfile?.ui?.languages?.active !== false} onChange={(value) => updateUiField('languages.active', value)} />
                <ToggleRow label="Map Button" checked={draftProfile?.ui?.map?.active !== false} onChange={(value) => updateUiField('map.active', value)} />
                <ToggleRow label="Terms Button" checked={draftProfile?.ui?.terms?.active !== false} onChange={(value) => updateUiField('terms.active', value)} />
                <ToggleRow label="Receipt Button" checked={draftProfile?.ui?.receipt?.active !== false} onChange={(value) => updateUiField('receipt.active', value)} />
              </div>
            )}

            {activeTab === 'Copy' && (
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <ProfileField label="Language">
                    <SelectInput
                      value={selectedLanguage}
                      onChange={setSelectedLanguage}
                      options={KIOSK_PROFILE_LANGUAGES.map((language) => ({ value: language.key, label: language.label }))}
                    />
                  </ProfileField>
                  <div className="space-y-1">
                    {KIOSK_PROFILE_SCREENS.map((screen) => (
                      <button
                        key={screen.key}
                        type="button"
                        onClick={() => setSelectedScreen(screen.key)}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium ${selectedScreen === screen.key ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        {screen.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-gray-900">{LANGUAGE_LABELS[selectedLanguage]} · {KIOSK_PROFILE_SCREENS.find((screen) => screen.key === selectedScreen)?.label}</h3>
                  {copyFields.map((field) => (
                    <ProfileField key={field.path} label={field.label}>
                      <textarea
                        value={getNestedValue(draftProfile?.languages?.[selectedLanguage] || {}, field.path, '')}
                        onChange={(event) => updateLanguageField(selectedLanguage, field.path, event.target.value)}
                        rows={String(getNestedValue(draftProfile?.languages?.[selectedLanguage] || {}, field.path, '')).length > 80 ? 3 : 2}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </ProfileField>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'Assign' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-gray-600">
                    {selectedStationIds.length} selected · {matchingKiosks.filter((kiosk) => isKioskOnline(kiosk)).length} online
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedStationIds(matchingKiosks.map((kiosk) => kiosk.stationid))} className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">
                      Select All
                    </button>
                    <button onClick={() => setSelectedStationIds([])} className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">
                      Clear
                    </button>
                    <button onClick={applyProfile} disabled={selectedStationIds.length === 0} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300">
                      Apply & Push
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {matchingKiosks.map((kiosk) => {
                    const selected = selectedStationIds.includes(kiosk.stationid);
                    const online = isKioskOnline(kiosk);
                    return (
                      <button
                        key={kiosk.stationid}
                        type="button"
                        onClick={() => toggleStation(kiosk.stationid)}
                        className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                          selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <span>
                          <span className="block font-semibold text-gray-800">{kiosk.stationid}</span>
                          <span className="text-xs text-gray-500">{kiosk.info?.location || kiosk.info?.place || '-'}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${online ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {selected && <CheckCircleIcon className="h-4 w-4" />}
                          {online ? 'online' : 'offline'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <KioskPreview profile={draftProfile} />
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{draftProfile?.name || 'Unsaved profile'}</h2>
                <p className="text-xs text-gray-500">v{draftProfile?.version || 1} · {draftProfile?.status || 'draft'}</p>
              </div>
              <button onClick={deleteProfile} className="rounded-md bg-red-50 p-2 text-red-700 hover:bg-red-100" title="Delete profile">
                <TrashIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
