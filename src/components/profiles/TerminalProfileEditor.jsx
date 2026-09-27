import {useState} from 'react';
import {KIOSK_PROFILE_LANGUAGES} from '../../utils/kioskUiProfiles.js';
import {getTerminalProfileCopy, hasTerminalOverride, P68_FIELDS, setTerminalProfileCopy} from '../../../functions/uiProfileSections.mjs';
import ApolloProfileEditor from './ApolloProfileEditor.jsx';

export default function TerminalProfileEditor(props) {
  return props.section === 'apollo'
    ? <ApolloProfileEditor key={`${props.profile.id}:${props.stationId}`} {...props} />
    : <P68ProfileEditor {...props} />;
}

function P68ProfileEditor({profile, section, stationId, language, onLanguageChange, onChange, disabled}) {
  const [p68Screen, setP68Screen] = useState('start');
  const copy = getTerminalProfileCopy(profile, section, stationId);
  const fields = P68_FIELDS.map(({key, label}) => [key, copy.locales?.[language]?.[key] || '', label]);
  const custom = hasTerminalOverride(profile, section, stationId);
  const update = (key, value) => {
    const nextCopy = {locales: {...copy.locales, [language]: {...copy.locales[language], [key]: value}}};
    onChange(setTerminalProfileCopy(profile, section, stationId, nextCopy));
  };
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0">
      <h3 className="text-lg font-bold text-slate-900">P68 messages</h3>
      <p className="mt-1 text-sm text-slate-500">{stationId ? `${stationId} · ${custom ? 'Custom text' : 'Using client default. Editing creates custom text.'}` : 'Default text for this client. Kiosks with custom text keep their own settings.'}</p>
      <div role="tablist" aria-label="Terminal language" className="my-5 flex gap-1 rounded-xl bg-slate-100 p-1">
        {KIOSK_PROFILE_LANGUAGES.map(({key, label}) => <button type="button" role="tab" aria-selected={language === key} key={key} onClick={() => onLanguageChange(key)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${language === key ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
      </div>
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        {fields.map(([key, value, label]) => <label key={key} className="block text-sm font-semibold text-slate-700">{label}
          <textarea aria-label={`P68 ${label}`} rows={2} maxLength={4000} value={value} onFocus={() => setP68Screen(key)} onChange={(event) => update(key, event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-normal text-slate-900 outline-none focus:border-cyan-500" />
        </label>)}
      </fieldset>
      <p className="mt-5 text-xs leading-5 text-slate-500">These are the five messages supported by the existing P68 integration. Payment prompts and terminal firmware remain managed by Payter.</p>
    </div>
    <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-bold text-slate-900">P68 text preview</h3>
      <p className="mb-4 mt-1 text-xs text-slate-500">Text sample · actual wrapping depends on the terminal</p>
      <>
        <select aria-label="P68 preview message" value={p68Screen} onChange={(event) => setP68Screen(event.target.value)} className="mb-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          {P68_FIELDS.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div className="rounded-2xl bg-slate-800 p-5 text-center shadow-md">
          <div className="mb-4 text-sm font-semibold text-slate-300">payter P68</div>
          <div aria-label="P68 message preview" className="flex min-h-28 items-center justify-center break-words rounded bg-slate-100 px-3 py-5 font-mono text-lg text-slate-900">{copy.locales?.[language]?.[p68Screen]}</div>
        </div>
      </>
    </aside>
  </div>;
}
