import {useState} from 'react';
import {KIOSK_PROFILE_LANGUAGES} from '../../utils/kioskUiProfiles.js';
import {buildPayterTranslations, getPayterEditorFields, PAYTER_DEFAULT_TRANSLATIONS_META, PAYTER_UI_PAGES} from '../../utils/payterTerminal.js';
import {getTerminalProfileCopy, setTerminalProfileCopy} from '../../../functions/uiProfileSections.mjs';
import {
  APOLLO_BUTTON_LIMIT, APOLLO_SCREEN_EXITS, APOLLO_SCREEN_LAYOUTS, APOLLO_SCREEN_LIMIT,
  createApolloScreen, duplicateApolloScreen, emptyApolloScreenFlow, getApolloScreenFlowError,
  getRemovedApolloEstablishedScreenIds, removeApolloEstablishedScreen, removeApolloScreen,
  resolveApolloScreenAction, restoreApolloEstablishedScreen,
} from '../../../functions/apolloScreens.mjs';
import ApolloTerminalFrame from './ApolloTerminalFrame.jsx';

const fieldLabels = {startbutton: 'Start button', rentbutton: 'Rent button', returnbutton: 'Return button', infotext: 'Question', returntitle: 'Title', returntext: 'Instructions', modulelabel: 'Module label', slotlabel: 'Slot label'};
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-cyan-500';
const buttonClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40';

export default function ApolloProfileEditor({profile, language, onLanguageChange, onChange, disabled, allowEstablishedScreenRemoval = false}) {
  const [selectedId, setSelectedId] = useState('startpage');
  const [previewId, setPreviewId] = useState(null);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);
  const copy = getTerminalProfileCopy(profile, 'apollo');
  const translations = buildPayterTranslations(copy.translations);
  const flow = copy.screenFlow || emptyApolloScreenFlow();
  const removedEstablishedIds = getRemovedApolloEstablishedScreenIds(flow);
  const activeEstablishedPages = PAYTER_UI_PAGES.filter(({key}) => !removedEstablishedIds.includes(key));
  const removedEstablishedPages = PAYTER_UI_PAGES.filter(({key}) => removedEstablishedIds.includes(key));
  const selectedScreen = flow.screens.find(({id}) => id === selectedId);
  const currentId = (selectedScreen || activeEstablishedPages.some(({key}) => key === selectedId)) ? selectedId : activeEstablishedPages[0]?.key || 'startpage';
  const shownId = previewId || currentId;
  const shownScreen = flow.screens.find(({id}) => id === shownId);
  const selectedPage = PAYTER_UI_PAGES.find(({key}) => key === currentId);
  const shownPage = PAYTER_UI_PAGES.find(({key}) => key === shownId);
  const error = getApolloScreenFlowError(flow);
  const hasProfileTranslations = Boolean(Object.keys(copy.translations || {}).length);
  const savedTemplate = profile?.terminalProfiles?.apollo?.template;
  const qr = copy.qr || {enabled: false, provider: 'chargerent-issued', promptTitle: 'Borrow a charger', promptMessage: 'Scan your QR code'};
  const establishedFields = selectedPage ? getPayterEditorFields(translations, language, currentId) : [];
  const updateCopy = (next) => {
    setPreviewId(null); setNotice(''); setDeleting(false);
    onChange(setTerminalProfileCopy(profile, 'apollo', '', next));
  };
  const updateFlow = (next) => updateCopy({...copy, screenFlow: next});
  const updateScreen = (next) => updateFlow({...flow, screens: flow.screens.map((screen) => screen.id === next.id ? next : screen)});
  const selectScreen = (id) => {setSelectedId(id); setPreviewId(null); setNotice(''); setDeleting(false);};
  const addScreen = () => {
    const screen = createApolloScreen(flow.screens);
    updateFlow({...flow, screens: [...flow.screens, screen]});
    setSelectedId(screen.id);
  };
  const duplicate = () => {
    const next = duplicateApolloScreen(flow, selectedId);
    updateFlow(next); setSelectedId(next.screens.at(-1).id);
  };
  const removeCustom = () => {
    try {updateFlow(removeApolloScreen(flow, selectedId)); setSelectedId('startpage');}
    catch (problem) {setNotice(problem.message); setDeleting(false);}
  };
  const removeEstablished = () => {
    try {
      updateFlow(removeApolloEstablishedScreen(flow, currentId));
      setSelectedId(activeEstablishedPages.find(({key}) => key !== currentId)?.key || 'startpage');
    } catch (problem) {setNotice(problem.message); setDeleting(false);}
  };
  const restoreEstablished = (screenId) => {
    updateFlow(restoreApolloEstablishedScreen(flow, screenId));
    setSelectedId(screenId);
  };
  const updateLocale = (key, value) => updateScreen({...selectedScreen, locales: {...selectedScreen.locales, [language]: {...selectedScreen.locales[language], [key]: value}}});
  const updateButton = (id, patch) => updateScreen({...selectedScreen, buttons: selectedScreen.buttons.map((button) => button.id === id ? {...button, ...patch} : button)});
  const addButton = () => {
    let number = 1;
    while (selectedScreen.buttons.some(({id}) => id === `button_${number}`)) number++;
    updateScreen({...selectedScreen, buttons: [...selectedScreen.buttons, {id: `button_${number}`, labels: {en: 'Continue', fr: '', es: ''}, next: '$continue'}]});
  };
  const onPreviewAction = (action, payload) => {
    if (action === 'start_process') {
      setPreviewId(flow.entryScreenId || 'rentpage');
      setNotice(flow.entryScreenId ? '' : 'The existing rent / return flow continues here.');
    } else if (action === 'custom_screen') {
      const next = resolveApolloScreenAction(flow, shownId, payload.response);
      setPreviewId(next.action === 'show_screen' ? next.screenId : next.action === 'return_to_start' ? 'startpage' : 'rentpage');
      setNotice(next.action === 'continue_existing_flow' ? 'The existing rent / return flow continues here.' : '');
    }
  };

  return <div className="grid items-start gap-6 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
    <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Established screens</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Current shared Apollo flow</p>
        </div>
        <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-800">{activeEstablishedPages.length}</span>
      </div>
      <div role="tablist" aria-label="Established Apollo screens" className="space-y-1">
        {activeEstablishedPages.map((page, index) => {
          const fieldCount = getPayterEditorFields(translations, language, page.key).length;
          const active = currentId === page.key;
          return <button key={page.key} type="button" role="tab" aria-selected={active} onClick={() => selectScreen(page.key)} className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-white text-cyan-900 shadow-sm ring-1 ring-cyan-100' : 'text-slate-600 hover:bg-white'}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-cyan-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{index + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{page.displayLabel}</span><span className="block text-[10px] text-slate-400">{fieldCount} editable field{fieldCount === 1 ? '' : 's'}</span></span>
          </button>;
        })}
      </div>
      {removedEstablishedPages.length > 0 && <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1"><span className="text-xs font-bold text-slate-700">Removed screens</span><span className="text-[11px] font-semibold text-slate-400">{removedEstablishedPages.length}</span></div>
        <div className="space-y-1">{removedEstablishedPages.map((page) => <div key={page.key} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2">
          <span className="truncate text-xs font-semibold text-slate-500 line-through">{page.displayLabel}</span>
          <button type="button" onClick={() => restoreEstablished(page.key)} disabled={disabled || !allowEstablishedScreenRemoval} className="text-[10px] font-bold text-cyan-800 disabled:opacity-40">Restore</button>
        </div>)}</div>
      </div>}
      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1"><span className="text-xs font-bold text-slate-700">Added screens</span><span className="text-[11px] font-semibold text-slate-400">{flow.screens.length}</span></div>
        <div className="space-y-1">
          {flow.screens.map((screen) => <button key={screen.id} type="button" onClick={() => selectScreen(screen.id)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ${selectedId === screen.id ? 'bg-cyan-100 text-cyan-900' : 'text-slate-600 hover:bg-white'}`}><span className="truncate">{screen.name || 'Untitled screen'}</span><span className="rounded bg-white px-1.5 py-0.5 text-[9px] uppercase text-slate-400">{screen.type}</span></button>)}
          {!flow.screens.length && <p className="px-2 py-2 text-[11px] leading-4 text-slate-400">Optional screens appear here.</p>}
        </div>
        <button type="button" onClick={addScreen} disabled={disabled || flow.screens.length >= APOLLO_SCREEN_LIMIT} className="mt-2 w-full rounded-xl bg-cyan-700 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">+ Add screen</button>
      </div>
    </aside>
    <div className="min-w-0">
      <div className={`rounded-xl border p-4 ${hasProfileTranslations ? 'border-emerald-200 bg-emerald-50' : 'border-cyan-200 bg-cyan-50'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className={`text-sm ${hasProfileTranslations ? 'text-emerald-900' : 'text-cyan-950'}`}>{hasProfileTranslations ? 'Profile copy loaded' : 'Verified legacy baseline loaded'}</strong>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{activeEstablishedPages.length} active · {removedEstablishedPages.length} removed</span>
            {!hasProfileTranslations && <button type="button" disabled={disabled} onClick={() => updateCopy({...copy, template: PAYTER_DEFAULT_TRANSLATIONS_META, translations, screenFlow: flow})} className="rounded-lg bg-cyan-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Load YYZ default</button>}
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-slate-600">{hasProfileTranslations
          ? `${savedTemplate?.source || PAYTER_DEFAULT_TRANSLATIONS_META.source}. These values are saved with this client profile.`
          : `${PAYTER_DEFAULT_TRANSLATIONS_META.source}, verified ${PAYTER_DEFAULT_TRANSLATIONS_META.verifiedAt}. Initialize it explicitly, then review and save the client draft.`}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">One client-wide flow for every matching Apollo kiosk.</p>
      </div>
      <div className="my-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">{selectedScreen ? 'Added screen' : 'Established screen'}</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedScreen?.name || selectedPage?.displayLabel}</h3>
          {!selectedScreen && <p className="mt-1 text-xs text-slate-500">{establishedFields.length} editable field{establishedFields.length === 1 ? '' : 's'} in {language.toUpperCase()}</p>}
        </div>
        <div role="tablist" aria-label="Terminal language" className="flex min-w-72 gap-1 rounded-xl bg-slate-100 p-1">
          {KIOSK_PROFILE_LANGUAGES.map(({key, label}) => <button type="button" role="tab" aria-selected={language === key} key={key} onClick={() => onLanguageChange(key)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${language === key ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
        </div>
      </div>
      <fieldset disabled={disabled} className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4 disabled:opacity-60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-violet-950">QR-code vending</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-violet-800">Apollo reads the QR credential. The U.S. runtime validates it for this client before checking kiosk availability and sending a vend command. QR vends use the SCANNER gateway while the terminal hardware gateway remains APOLLO.</p>
          </div>
          <button type="button" role="switch" aria-checked={qr.enabled} onClick={() => updateCopy({...copy, qr: {...qr, enabled: !qr.enabled}})} className={`rounded-full px-3 py-1.5 text-xs font-bold ${qr.enabled ? 'bg-violet-700 text-white' : 'bg-white text-violet-700 ring-1 ring-violet-200'}`}>{qr.enabled ? 'Scanner enabled' : 'Scanner disabled'}</button>
        </div>
        {qr.enabled && <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-violet-950">Credential source
            <select value={qr.provider} onChange={(event) => updateCopy({...copy, qr: {...qr, provider: event.target.value}})} className={inputClass}>
              <option value="chargerent-issued">Chargerent-issued QR</option>
              <option value="library">Library-system QR</option>
              <option value="external">Client / partner QR</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-violet-950">Reader title
            <input value={qr.promptTitle} maxLength={120} onChange={(event) => updateCopy({...copy, qr: {...qr, promptTitle: event.target.value}})} className={inputClass} />
          </label>
          <label className="text-sm font-semibold text-violet-950 sm:col-span-2">Reader message
            <input value={qr.promptMessage} maxLength={240} onChange={(event) => updateCopy({...copy, qr: {...qr, promptMessage: event.target.value}})} className={inputClass} />
          </label>
        </div>}
      </fieldset>
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        {selectedScreen ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">Screen name
              <input aria-label="Screen name" value={selectedScreen.name} maxLength={80} onChange={(event) => updateScreen({...selectedScreen, name: event.target.value})} className={inputClass} />
              <span className="mt-1 block text-xs font-normal text-slate-500">For your dashboard only.</span>
            </label>
            <label className="text-sm font-semibold text-slate-700">Layout
              <select aria-label="Screen layout" value={selectedScreen.type} onChange={(event) => updateScreen({...selectedScreen, type: event.target.value})} className={inputClass}>
                {APOLLO_SCREEN_LAYOUTS.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500">English is the fallback for any untranslated field. Layout and button destinations are shared across languages.</p>
          <label className="block text-sm font-semibold text-slate-700">Title
            <input aria-label="Added screen title" value={selectedScreen.locales[language].title} placeholder={language !== 'en' ? selectedScreen.locales.en.title : ''} maxLength={120} onChange={(event) => updateLocale('title', event.target.value)} className={inputClass} />
          </label>
          {selectedScreen.type === 'message' && <label className="block text-sm font-semibold text-slate-700">Message
            <textarea aria-label="Added screen message" rows={3} value={selectedScreen.locales[language].message} placeholder={language !== 'en' ? selectedScreen.locales.en.message : ''} maxLength={600} onChange={(event) => updateLocale('message', event.target.value)} className={inputClass} />
          </label>}
          <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-bold text-slate-800">{selectedScreen.type === 'selection' ? 'Choices' : 'Buttons'}</h4>
            <button type="button" onClick={addButton} disabled={selectedScreen.buttons.length >= APOLLO_BUTTON_LIMIT} className={buttonClass}>Add button</button>
          </div>
          {selectedScreen.buttons.map((button, index) => <div key={button.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Button {index + 1}</span><button type="button" aria-label={`Remove button ${index + 1}`} disabled={selectedScreen.buttons.length === 1} onClick={() => updateScreen({...selectedScreen, buttons: selectedScreen.buttons.filter(({id}) => id !== button.id)})} className="text-xs font-semibold text-slate-500 disabled:opacity-30">Remove</button></div>
            <label className="mt-2 block text-sm font-semibold text-slate-700">Label
              <input aria-label={`Button ${index + 1} label`} value={button.labels[language]} maxLength={60} placeholder={language !== 'en' ? button.labels.en : ''} onChange={(event) => updateButton(button.id, {labels: {...button.labels, [language]: event.target.value}})} className={inputClass} />
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-700">When pressed
              <select aria-label={`Button ${index + 1} destination`} value={button.next} onChange={(event) => updateButton(button.id, {next: event.target.value})} className={inputClass}>
                {APOLLO_SCREEN_EXITS.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
                <optgroup label="Added screens">{flow.screens.map(({id, name}) => <option key={id} value={id}>{name || 'Untitled screen'}</option>)}</optgroup>
              </select>
            </label>
          </div>)}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={duplicate} disabled={flow.screens.length >= APOLLO_SCREEN_LIMIT} className={buttonClass}>Duplicate screen</button>
            <button type="button" onClick={() => setDeleting(true)} className={`${buttonClass} text-red-700`}>Delete screen</button>
          </div>
          {deleting && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
            <p>Delete “{selectedScreen.name}” from this draft? {flow.entryScreenId === selectedId && 'The flow will start with the existing rent / return screen.'}</p>
            <div className="mt-3 flex gap-2"><button type="button" onClick={removeCustom} className={buttonClass}>Confirm delete</button><button type="button" onClick={() => setDeleting(false)} className={buttonClass}>Keep screen</button></div>
          </div>}
        </> : <>
          {establishedFields.map(([key, value]) => {
          const label = fieldLabels[key] || key.replace(/^./, (char) => char.toUpperCase());
          return <label key={key} className="block text-sm font-semibold text-slate-700">{label}
            <textarea aria-label={`Apollo ${label}`} rows={2} maxLength={4000} value={value} onChange={(event) => updateCopy({...copy, translations: {...translations, [language]: {...translations[language], [currentId]: {...translations[language][currentId], [key]: event.target.value}}}})} className={inputClass} />
          </label>;
          })}
          <div className="border-t border-slate-100 pt-4">
            {selectedPage?.removable && allowEstablishedScreenRemoval
              ? <button type="button" onClick={() => setDeleting(true)} className={`${buttonClass} text-red-700`}>Remove from flow</button>
              : <p className="text-xs font-semibold text-slate-500">{selectedPage?.removable ? 'Deploy the established-screen backend contract before removing this screen.' : 'Required flow screen · it can be edited but not removed.'}</p>}
          </div>
          {deleting && selectedPage?.removable && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
            <p>Remove “{selectedPage.displayLabel}” from this client flow? Its saved text is kept, so you can restore the screen later.</p>
            <p className="mt-1 text-xs leading-5">The terminal business event still runs. When Apollo publishing is enabled, the bridge will bypass this presentation screen.</p>
            <div className="mt-3 flex gap-2"><button type="button" onClick={removeEstablished} className={buttonClass}>Confirm remove</button><button type="button" onClick={() => setDeleting(false)} className={buttonClass}>Keep screen</button></div>
          </div>}
        </>}
      </fieldset>
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-bold text-slate-800">Optional added-screen entry</h4>
        <label className="mt-3 block text-sm font-semibold text-slate-700">After Start, show
          <select aria-label="First added Apollo screen" value={flow.entryScreenId} disabled={disabled} onChange={(event) => updateFlow({...flow, entryScreenId: event.target.value})} className={inputClass}>
            <option value="">Established rent / return screen</option>
            {flow.screens.map(({id, name}) => <option key={id} value={id}>{name || 'Untitled screen'}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">Leave this on the established rent / return screen unless an added screen should appear first. Payment and dispensing stay in the established flow.</p>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}
      <p className="mt-5 text-xs leading-5 text-slate-500">Added screens use Payter message and selection layouts. Terminal support must be verified before publishing. Images and firmware remain managed through MyPayter.</p>
    </div>
    <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4">
      <h3 className="font-bold text-slate-900">Apollo preview</h3>
      <p className="mb-4 mt-1 text-xs text-slate-500">Interactive draft · approximate layout</p>
      <div className="flex justify-center"><ApolloTerminalFrame compact terminal={{online: false, uistate: shownId, language, defaultLanguage: language, dynamicData: {slot: '4', module: '1'}}} translations={translations} customScreen={shownScreen} onAction={!error && (shownScreen || shownId === 'startpage') ? onPreviewAction : null} /></div>
      <p className="mt-3 text-center text-xs font-semibold text-slate-600">{shownScreen?.name || shownPage?.displayLabel}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2"><button type="button" disabled={Boolean(error)} onClick={() => {setPreviewId('startpage'); setNotice('Press Start in the preview to try the screen sequence.');}} className={buttonClass}>{previewId ? 'Restart preview' : 'Try flow'}</button>
        {previewId && <button type="button" onClick={() => {setPreviewId(null); setNotice('');}} className={buttonClass}>Back to editing</button>}
      </div>
      <p className="mt-3 text-center text-xs leading-5 text-slate-500">Preview buttons only navigate this draft. No terminal commands or payments are sent.</p>
    </aside>
  </div>;
}
