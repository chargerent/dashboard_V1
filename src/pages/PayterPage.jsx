import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  CloudArrowUpIcon,
  ComputerDesktopIcon,
  CreditCardIcon,
  EyeIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  SignalIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { collection, doc, onSnapshot } from 'firebase/firestore';

import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import { db } from '../firebase-config.js';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import {
  PAYTER_DEFAULT_TRANSLATIONS,
  PAYTER_LANGUAGES,
  PAYTER_UI_PAGES,
  buildPayterTranslations,
  getPayterConnectionState,
  getPayterEditorFields,
  normalizePayterTerminal,
  payterTerminalMatchesSearch,
} from '../utils/payterTerminal.js';
import './PayterPage.css';
import PayterTerminalFrame from '../components/profiles/ApolloTerminalFrame.jsx';

const LOCAL_PREVIEW_TERMINALS = [
  normalizePayterTerminal({
    terminalId: 'preview-1', serialNumber: 'PREVIEW0001', terminalName: 'CA Preview 1',
    state: 'IDLE', online: true, live: true, currentLanguage: 'en', defaultLanguage: 'en',
    uistate: 'startpage', updatedAtMs: Number.MAX_SAFE_INTEGER,
  }),
  normalizePayterTerminal({
    terminalId: 'preview-2', serialNumber: 'PREVIEW0002', terminalName: 'CA Preview 2',
    state: 'IDLE', online: true, live: true, currentLanguage: 'fr', defaultLanguage: 'fr',
    uistate: 'paymentpage', updatedAtMs: Number.MAX_SAFE_INTEGER,
  }),
  normalizePayterTerminal({
    terminalId: 'preview-3', serialNumber: 'PREVIEW0003', terminalName: 'CA Preview 3',
    state: 'Unknown', online: false, live: false, currentLanguage: 'es', defaultLanguage: 'es',
    uistate: 'thankyoupage', slot: '4', module: '1', updatedAtMs: Number.MAX_SAFE_INTEGER,
  }),
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function TerminalCard({terminal, translations, now, commandsEnabled, busyAction, onCommand, onEditProfile}) {
  const displayOnline = getPayterConnectionState(terminal, now) === 'online';
  const handleScreenAction = commandsEnabled
    ? (action, payload) => onCommand(action, terminal, payload)
    : null;

  return (
    <article className="payter-terminal-card">
      <div className="payter-terminal-heading">
        <div>
          <h3>{terminal.terminalName || 'N/A'}</h3>
          <p>{terminal.serialNumber || 'No serial number'}</p>
        </div>
        <span className={`payter-status-pill ${displayOnline ? 'online' : 'offline'}`}>
          <span />{displayOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="payter-terminal-display-area">
        <PayterTerminalFrame terminal={{...terminal, online: displayOnline}} translations={translations} compact onAction={handleScreenAction} />
      </div>
      <div className="payter-terminal-info">
        <div className="payter-info-item"><span className="payter-info-label">State:</span><span className="payter-info-value">{terminal.state || 'N/A'}</span></div>
        <div className="payter-info-item"><span className="payter-info-label">UI screen:</span><span className="payter-info-value">{terminal.uistate}</span></div>
        <div className="payter-info-item"><span className="payter-info-label">Language:</span><span className="payter-info-value">{terminal.language.toUpperCase()}</span></div>
        <div className="payter-info-item"><span className="payter-info-label">Default:</span><span className="payter-info-value">{(terminal.defaultLanguage || 'N/A').toUpperCase()}</span></div>
        <div className="payter-info-item">
          <span className="payter-info-label">Live Mode:</span>
          <label className={`payter-live-switch ${busyAction === 'set_live' ? 'pending' : ''} ${commandsEnabled ? '' : 'locked'}`}>
            <input type="checkbox" checked={terminal.live} onChange={() => commandsEnabled && onCommand('set_live', terminal, {targetState: !terminal.live})} aria-label={`Live mode for ${terminal.terminalName}`} />
            <span className="payter-live-slider" />
          </label>
        </div>
      </div>
      <div className="payter-reboot-container">
        {onEditProfile && <button type="button" className="payter-editor-button" onClick={() => onEditProfile(terminal.serialNumber)}>Edit profile</button>}
        <button type="button" className={`payter-reboot-button ${commandsEnabled ? '' : 'locked'}`} onClick={() => commandsEnabled && onCommand('reboot', terminal)} aria-disabled={!commandsEnabled}>
          <ArrowPathIcon /> {busyAction === 'reboot' ? 'Rebooting…' : 'Reboot'}
        </button>
      </div>
    </article>
  );
}

function PayterSummaryCard({icon: Icon, label, value, detail, tone = 'blue'}) {
  return (
    <div className="payter-summary-card">
      <span className={`payter-summary-icon ${tone}`}><Icon /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function PayterAdmin({terminals, translations, now, loading, search, onSearch, commandsEnabled, busyByTerminal, onCommand, onEditProfile}) {
  const filteredTerminals = terminals.filter((terminal) => payterTerminalMatchesSearch(terminal, search));
  const onlineCount = terminals.filter((terminal) => getPayterConnectionState(terminal, now) === 'online').length;
  const liveCount = terminals.filter((terminal) => terminal.live).length;
  return (
    <>
      <section className="payter-summary-grid" aria-label="Payter terminal summary">
        <PayterSummaryCard icon={CreditCardIcon} label="Managed terminals" value={terminals.length} detail="Payter devices in this workspace" />
        <PayterSummaryCard icon={SignalIcon} label="Online" value={onlineCount} detail="Reporting within two minutes" tone="green" />
        <PayterSummaryCard icon={BoltIcon} label="Live mode" value={liveCount} detail="Ready for live transactions" tone="amber" />
      </section>
      <section className="payter-admin-tools">
        <div className="payter-search-wrap">
          <MagnifyingGlassIcon />
          <input className="payter-search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Find terminal by name, serial, state, or language" aria-label="Find a terminal" />
        </div>
        <span className="payter-terminal-count">{filteredTerminals.length} terminal{filteredTerminals.length === 1 ? '' : 's'}</span>
      </section>
      <div className="payter-terminals-container">
        {loading ? <div className="payter-empty-state">Loading terminal data…</div> : filteredTerminals.length === 0 ? (
          <div className="payter-empty-state">Waiting for terminal data…</div>
        ) : filteredTerminals.map((terminal) => (
          <TerminalCard key={terminal.id} terminal={terminal} translations={translations} now={now} commandsEnabled={commandsEnabled} busyAction={busyByTerminal[terminal.id]} onCommand={onCommand} onEditProfile={onEditProfile} />
        ))}
      </div>
    </>
  );
}

function PayterEditor({translations, selectedTerminal, editorEnabled, onSave}) {
  const preparedTranslations = useMemo(() => buildPayterTranslations(translations), [translations]);
  const [activePage, setActivePage] = useState('startpage');
  const [activeLanguage, setActiveLanguage] = useState('en');
  const [baseline, setBaseline] = useState(() => clone(preparedTranslations));
  const [working, setWorking] = useState(() => clone(preparedTranslations));
  const [preview, setPreview] = useState(() => clone(preparedTranslations));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseline(clone(preparedTranslations));
    setWorking(clone(preparedTranslations));
    setPreview(clone(preparedTranslations));
  }, [preparedTranslations]);

  const fields = getPayterEditorFields(working, activeLanguage, activePage);
  const hasChanges = JSON.stringify(working) !== JSON.stringify(baseline);
  const fieldEdited = (key, value) => value !== baseline?.[activeLanguage]?.[activePage]?.[key];
  const pageEdited = (page) => PAYTER_LANGUAGES.some(({code}) => JSON.stringify(working?.[code]?.[page]) !== JSON.stringify(baseline?.[code]?.[page]));
  const languageEdited = (language) => JSON.stringify(working?.[language]) !== JSON.stringify(baseline?.[language]);

  const updateField = (key, value) => {
    setWorking((current) => ({
      ...current,
      [activeLanguage]: {
        ...current[activeLanguage],
        [activePage]: {...current[activeLanguage][activePage], [key]: value},
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave(working);
      if (saved) setBaseline(clone(working));
    } finally {
      setSaving(false);
    }
  };

  const previewTerminal = {
    ...(selectedTerminal || LOCAL_PREVIEW_TERMINALS[0]),
    online: true,
    uistate: activePage,
    language: activeLanguage,
    defaultLanguage: activeLanguage,
    dynamicData: {slot: '4', module: '1'},
    translations: preview,
  };

  return (
    <div className="payter-editor-layout">
      <section className="payter-editor-left">
        <div className="payter-editor-controls">
          <div className="payter-editor-heading">
            <span><PaintBrushIcon /></span>
            <div><strong>Terminal UI copy</strong><small>Edit and preview Payter screen text</small></div>
          </div>
          <div className="payter-editor-actions">
            <button type="button" className="payter-editor-button save" onClick={handleSave} disabled={saving}><CloudArrowUpIcon />{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" className="payter-editor-button reset" onClick={() => setWorking(clone(baseline))} disabled={!hasChanges}><ArrowUturnLeftIcon />Reset</button>
            <button type="button" className="payter-editor-button load" onClick={() => setPreview(clone(working))}><EyeIcon />Preview</button>
          </div>
        </div>
        <div className="payter-editor-container">
          <nav className="payter-page-tabs" aria-label="Payter UI pages">
            {PAYTER_UI_PAGES.map(({key, label}) => (
              <button key={key} type="button" className={`payter-page-tab ${activePage === key ? 'active' : ''} ${pageEdited(key) ? 'edited' : ''}`} onClick={() => setActivePage(key)}>{label}</button>
            ))}
          </nav>
          <div className="payter-editor-main">
            <div className="payter-language-tabs" role="tablist" aria-label="Translation language">
              {PAYTER_LANGUAGES.map(({code, label}) => (
                <button key={code} type="button" role="tab" aria-selected={activeLanguage === code} className={`payter-language-tab ${activeLanguage === code ? 'active' : ''} ${languageEdited(code) ? 'edited' : ''}`} onClick={() => setActiveLanguage(code)}>{label}</button>
              ))}
            </div>
            <div className="payter-editor-fields">
              {fields.map(([key, value]) => {
                const edited = fieldEdited(key, value);
                return (
                  <div className={`payter-field-group ${edited ? 'edited' : ''}`} key={key}>
                    <label htmlFor={`payter-${activeLanguage}-${activePage}-${key}`}>{key}{edited && <span className="payter-edit-star">*</span>}</label>
                    <input id={`payter-${activeLanguage}-${activePage}-${key}`} type="text" value={value} onChange={(event) => updateField(key, event.target.value)} />
                  </div>
                );
              })}
            </div>
            {!editorEnabled && <div className="payter-editor-lock-note">Saving is protected until the authenticated translation bridge is enabled. Load and preview work locally.</div>}
          </div>
        </div>
      </section>
      <section className="payter-editor-preview">
        <div className="payter-editor-preview-label"><EyeIcon /><span>Terminal preview</span></div>
        <PayterTerminalFrame terminal={previewTerminal} translations={preview} />
      </section>
    </div>
  );
}

export default function PayterPage({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onNavigateToProfiles,
  onLogout,
  currentUser,
  t = (key) => key,
  previewMode = false,
}) {
  const [terminals, setTerminals] = useState(previewMode ? LOCAL_PREVIEW_TERMINALS : []);
  const [runtime, setRuntime] = useState({stateBridgeReady: previewMode, commandsEnabled: false, editorEnabled: false});
  const [config, setConfig] = useState({translations: previewMode ? PAYTER_DEFAULT_TRANSLATIONS : {}});
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState('');
  const [activeView, setActiveView] = useState('admin');
  const [search, setSearch] = useState('');
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const [busyByTerminal, setBusyByTerminal] = useState({});
  const [commandStatus, setCommandStatus] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const isAdmin = currentUser?.isAdmin === true || currentUser?.role === 'admin' || currentUser?.username === 'chargerent';

  useEffect(() => {
    if (previewMode) return undefined;
    if (!isAdmin) {
      setLoading(false);
      return undefined;
    }

    const stopTerminals = onSnapshot(collection(db, 'payterTerminals'), (snapshot) => {
      const nextTerminals = snapshot.docs
        .map((snapshotDocument) => normalizePayterTerminal(snapshotDocument.data(), snapshotDocument.id))
        .sort((left, right) => left.terminalName.localeCompare(right.terminalName) || left.serialNumber.localeCompare(right.serialNumber));
      setTerminals(nextTerminals);
      setSelectedTerminalId((current) => nextTerminals.some((terminal) => terminal.id === current) ? current : (nextTerminals[0]?.id || ''));
      setLoadError('');
      setLoading(false);
    }, (error) => {
      console.error('Unable to subscribe to Payter terminal state', error);
      setLoadError('Unable to read Payter terminal state. Confirm this account still has Chargerent administrator access.');
      setLoading(false);
    });

    const stopRuntime = onSnapshot(doc(db, 'payterRuntime', 'current'), (snapshot) => {
      const data = snapshot.data() || {};
      setRuntime({stateBridgeReady: data.stateBridgeReady === true, commandsEnabled: data.commandsEnabled === true, editorEnabled: data.editorEnabled === true});
    }, (error) => console.warn('Unable to read Payter bridge readiness', error));

    const stopConfig = onSnapshot(doc(db, 'payterUiConfig', 'current'), (snapshot) => {
      const data = snapshot.data() || {};
      setConfig({translations: data.translations && typeof data.translations === 'object' ? data.translations : {}});
    }, (error) => console.warn('Unable to read Payter UI config', error));

    return () => { stopTerminals(); stopRuntime(); stopConfig(); };
  }, [isAdmin, previewMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedTerminal = terminals.find((terminal) => terminal.id === selectedTerminalId) || terminals[0] || null;
  const sharedTranslations = useMemo(() => {
    if (config.translations && Object.keys(config.translations).length > 0) return buildPayterTranslations(config.translations);
    if (selectedTerminal?.translations && Object.keys(selectedTerminal.translations).length > 0) return buildPayterTranslations(selectedTerminal.translations);
    return buildPayterTranslations(PAYTER_DEFAULT_TRANSLATIONS);
  }, [config.translations, selectedTerminal]);

  const sendCommand = useCallback(async (action, terminal, args = {}) => {
    if (!runtime.commandsEnabled) {
      setCommandStatus({state: 'error', message: 'Payter controls are locked until the secure command bridge is enabled.'});
      return;
    }
    if (action === 'reboot' && !window.confirm(`Reboot ${terminal.terminalName}? The terminal will briefly disconnect.`)) return;
    setBusyByTerminal((current) => ({...current, [terminal.id]: action}));
    setCommandStatus({state: 'sending', message: 'Sending Payter command…'});
    try {
      const response = await callFunctionWithAuth('payter_sendCommand', {action, terminalId: terminal.id, serialNumber: terminal.serialNumber, ...args});
      setCommandStatus({state: 'success', message: response?.message || 'Payter command accepted.'});
    } catch (error) {
      setCommandStatus({state: 'error', message: error?.message || 'Payter command failed.'});
    } finally {
      setBusyByTerminal((current) => ({...current, [terminal.id]: ''}));
    }
  }, [runtime.commandsEnabled]);

  const saveTranslations = useCallback(async (translations) => {
    if (!runtime.editorEnabled) {
      setCommandStatus({state: 'error', message: 'Payter UI saving is locked until the translation bridge is enabled.'});
      return false;
    }
    setCommandStatus({state: 'sending', message: 'Saving Payter translations…'});
    try {
      const response = await callFunctionWithAuth('payter_saveUiConfig', {translations});
      setCommandStatus({state: 'success', message: response?.message || 'Payter translations saved.'});
      return true;
    } catch (error) {
      setCommandStatus({state: 'error', message: error?.message || 'Could not save Payter translations.'});
      return false;
    }
  }, [runtime.editorEnabled]);

  if (!isAdmin) {
    return <div className="min-h-screen bg-gray-100 p-6"><div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">Payter administration is available only to Chargerent administrators.</div></div>;
  }

  return (
    <div className="payter-page">
      <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
      <header className="payter-dashboard-header">
        <div className="payter-header-inner">
          <div className="payter-header-title">
            <span className="payter-header-mark"><CreditCardIcon /></span>
            <div>
              <h1>Payter terminals</h1>
              <p>Terminal monitoring and interface management</p>
            </div>
          </div>
          <div className="payter-header-actions">
            <button type="button" className="payter-header-button home" onClick={onNavigateToDashboard} aria-label="Back to dashboard" title="Back to dashboard"><HomeIcon /></button>
            <button type="button" className="payter-header-button admin" onClick={onNavigateToAdmin} aria-label="Back to admin tools" title="Back to admin tools"><UserCircleIcon /></button>
            <button type="button" className="payter-header-button logout" onClick={onLogout} aria-label={t('logout')} title={t('logout')}><ArrowRightOnRectangleIcon /></button>
          </div>
        </div>
      </header>

      <main className="payter-main">
        <section className="payter-workspace-bar">
          <div>
            <h2>Payter workspace</h2>
            <p>Monitor terminal state or preview localized interface copy.</p>
          </div>
          <nav className="payter-nav" aria-label="Payter pages">
            <button type="button" className={`payter-nav-button ${activeView === 'admin' ? 'active' : ''}`} onClick={() => setActiveView('admin')}><ComputerDesktopIcon />Terminals</button>
            <button type="button" className={`payter-nav-button ${activeView === 'editor' ? 'active' : ''}`} onClick={() => previewMode ? setActiveView('editor') : onNavigateToProfiles?.()}><PaintBrushIcon />{previewMode ? 'UI preview' : 'Edit client profiles'}</button>
          </nav>
        </section>
        {!previewMode && !runtime.stateBridgeReady && <div className="payter-migration-note"><strong>Safe migration mode:</strong> live state and controls activate only after the new bridge is validated. Existing Node-RED callbacks are unchanged.</div>}
        {loadError && <div className="payter-load-error">{loadError}</div>}

        {previewMode && activeView === 'editor' ? (
          <PayterEditor translations={sharedTranslations} selectedTerminal={selectedTerminal} editorEnabled={runtime.editorEnabled} onSave={saveTranslations} />
        ) : (
          <PayterAdmin terminals={terminals} translations={sharedTranslations} now={now} loading={loading} search={search} onSearch={setSearch} commandsEnabled={runtime.commandsEnabled} busyByTerminal={busyByTerminal} onCommand={sendCommand} onEditProfile={onNavigateToProfiles} />
        )}
      </main>
    </div>
  );
}
