import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  MusicalNoteIcon,
  PencilSquareIcon,
  PhoneIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase-config.js';

const inputClass = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const promptMediaBaseUrl = 'https://us-central1-node-red-alerts.cloudfunctions.net/support_voicePromptMedia';
const defaultSupportNumber = '+19179939355';
const voicePrompts = Object.freeze([
  { key: 'recording_notice', label: 'Recording and transcription notice', fallback: 'This call may be recorded and transcribed for quality purposes.' },
  { key: 'hold_waiting', label: 'Caller hold message', fallback: 'Played while available app staff are ringing.' },
  { key: 'staff_screen', label: 'Staff call screen', fallback: 'Chargerent customer support call. Press 1 to accept.' },
  { key: 'connecting', label: 'Connecting caller', fallback: 'Connecting you now.' },
  { key: 'callback_offer', label: 'Missed-call choices', fallback: 'Offers callback at the caller ID or voicemail.' },
  { key: 'callback_confirmed', label: 'Callback confirmation', fallback: 'Confirms that support will call back.' },
  { key: 'voicemail_greeting', label: 'Voicemail greeting', fallback: 'Requests contact, rental location, and a short description.' },
  { key: 'voicemail_confirmed', label: 'Voicemail confirmation', fallback: 'Confirms that the support team will follow up.' },
]);
const emptyForm = Object.freeze({
  staffId: '',
  name: '',
  phoneE164: '',
  deliveryMode: 'app',
  userUid: '',
  supportNumbers: defaultSupportNumber,
  routingGroup: 'primary',
  routingOrder: 1,
  enabled: true,
});

function sortStaff(left, right) {
  const groups = { primary: 0, backup: 1 };
  return (groups[left.routingGroup] ?? 2) - (groups[right.routingGroup] ?? 2)
    || Number(left.routingOrder || 100) - Number(right.routingOrder || 100)
    || String(left.name || '').localeCompare(String(right.name || ''));
}

function routeLabel(group) {
  return group === 'backup' ? 'Backup group' : 'Primary group';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The MP3 file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function fileSizeLabel(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '';
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

export default function TelephonyRoutingModal({ onClose, callSupportFunction, readOnly = false }) {
  const [staff, setStaff] = useState([]);
  const [users, setUsers] = useState([]);
  const [routingMode, setRoutingMode] = useState('phone');
  const [prompts, setPrompts] = useState([]);
  const [uploadingPrompt, setUploadingPrompt] = useState('');
  const [promptError, setPromptError] = useState('');
  const [promptSuccess, setPromptSuccess] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => onSnapshot(collection(db, 'supportTelephonyStaff'), (snapshot) => {
    setStaff(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })).sort(sortStaff));
    setLoading(false);
  }, (snapshotError) => {
    console.error('Unable to load support call routing', snapshotError);
    setError('Call routing could not be loaded.');
    setLoading(false);
  }), []);

  useEffect(() => onSnapshot(doc(db, 'supportTelephonyConfig', 'voice'), (snapshot) => {
    setRoutingMode(snapshot.data()?.routingMode === 'app' ? 'app' : 'phone');
  }, (snapshotError) => {
    console.error('Unable to load support voice routing mode', snapshotError);
  }), []);

  useEffect(() => onSnapshot(collection(db, 'supportVoicePrompts'), (snapshot) => {
    setPrompts(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
  }, (snapshotError) => {
    console.error('Unable to load support voice prompts', snapshotError);
    setPromptError('Voice prompts could not be loaded.');
  }), []);

  useEffect(() => {
    let cancelled = false;
    callSupportFunction('admin_listUsers')
      .then((result) => {
        if (!cancelled) setUsers((result?.users || []).filter((user) => user?.uid));
      })
      .catch((loadError) => {
        console.error('Unable to load staff accounts for app calling', loadError);
      });
    return () => { cancelled = true; };
  }, [callSupportFunction]);

  const groups = useMemo(() => ({
    primary: staff.filter((member) => member.routingGroup !== 'backup'),
    backup: staff.filter((member) => member.routingGroup === 'backup'),
  }), [staff]);
  const promptsByKey = useMemo(() => Object.fromEntries(prompts.map((prompt) => [prompt.id, prompt])), [prompts]);

  const editStaff = (member) => {
    setForm({
      staffId: member.id,
      name: member.name || '',
      phoneE164: member.phoneE164 || '',
      deliveryMode: member.deliveryMode || 'phone',
      userUid: member.userUid || '',
      supportNumbers: Array.isArray(member.supportNumbers) && member.supportNumbers.length
        ? member.supportNumbers.join(', ')
        : defaultSupportNumber,
      routingGroup: member.routingGroup || 'primary',
      routingOrder: member.routingOrder || 1,
      enabled: member.enabled !== false,
    });
    setError('');
    setSuccess('');
  };

  const saveStaff = async (event) => {
    event.preventDefault();
    if (readOnly || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await callSupportFunction('support_upsertTelephonyStaff', {
        ...form,
        supportNumbers: String(form.supportNumbers || '').split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
        routingOrder: Number(form.routingOrder),
      });
      setSuccess(form.staffId ? 'Staff routing updated.' : 'Staff member added to call routing.');
      setForm(emptyForm);
    } catch (saveError) {
      setError(saveError?.message || 'Staff routing could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const updateRoutingMode = async (nextMode) => {
    if (readOnly || saving || nextMode === routingMode) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await callSupportFunction('support_setVoiceRoutingMode', { routingMode: nextMode });
      setRoutingMode(nextMode);
      setSuccess(nextMode === 'app'
        ? 'Incoming calls now route to available staff apps.'
        : 'Incoming calls now use personal phone fallback.');
    } catch (saveError) {
      setError(saveError?.message || 'Voice routing mode could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const uploadVoicePrompt = async (promptKey, file, input) => {
    if (!file || readOnly || uploadingPrompt) return;
    setPromptError('');
    setPromptSuccess('');
    if (!/\.mp3$/i.test(file.name)) {
      setPromptError('Choose an MP3 file.');
      input.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setPromptError('Voice prompts must be 8 MB or smaller.');
      input.value = '';
      return;
    }
    setUploadingPrompt(promptKey);
    try {
      const dataBase64 = await readFileAsBase64(file);
      await callSupportFunction('support_uploadVoicePrompt', {
        promptKey,
        fileName: file.name,
        contentType: file.type || 'audio/mpeg',
        dataBase64,
      }, { timeoutMs: 120000, timeoutMessage: 'The MP3 upload took too long.' });
      setPromptSuccess(`${voicePrompts.find((prompt) => prompt.key === promptKey)?.label || 'Voice prompt'} uploaded.`);
    } catch (uploadError) {
      setPromptError(uploadError?.message || 'The voice prompt could not be uploaded.');
    } finally {
      setUploadingPrompt('');
      input.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="telephony-routing-title">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <PhoneIcon className="h-6 w-6 text-blue-600" />
              <h2 id="telephony-routing-title" className="text-xl font-black text-gray-900">Call routing</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">Each employee receives and sees calls only for their assigned support number(s).</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Close call routing">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <div className="space-y-5">
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <h3 className="font-bold text-blue-950">Active incoming call route</h3>
              <p className="mt-1 text-xs text-blue-800">Choose where Twilio sends new calls. App routing rings only staff who are enabled and marked available.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={readOnly || saving} onClick={() => updateRoutingMode('app')} className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold ${routingMode === 'app' ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-200 bg-white text-blue-900'}`}>
                  iPhone staff apps
                </button>
                <button type="button" disabled={readOnly || saving} onClick={() => updateRoutingMode('phone')} className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold ${routingMode === 'phone' ? 'border-slate-700 bg-slate-700 text-white' : 'border-blue-200 bg-white text-blue-900'}`}>
                  Personal phone fallback
                </button>
              </div>
            </section>
            {loading && <p className="text-sm text-gray-500">Loading routing staff…</p>}
            {!loading && ['primary', 'backup'].map((group) => (
              <section key={group} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-gray-900">{routeLabel(group)}</h3>
                    <p className="mt-1 text-xs text-gray-500">{group === 'primary' ? 'Available staff apps ring simultaneously first.' : 'Available backup staff apps ring if nobody in the primary group answers.'}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-gray-600 shadow-sm">{groups[group].filter((member) => member.enabled !== false).length} active</span>
                </div>
                <div className="mt-3 space-y-2">
                  {groups[group].map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-gray-900">{member.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${member.enabled !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>{member.enabled !== false ? 'Active' : 'Disabled'}</span>
                          {(member.deliveryMode || 'phone') === 'app' && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${member.available === true ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>{member.available === true ? 'Available in app' : 'Unavailable'}</span>}
                        </div>
                        <p className="mt-1 font-mono text-xs text-gray-500">{(member.deliveryMode || 'phone') === 'app' ? (member.twilioIdentity || 'App identity pending') : member.phoneE164} · order {member.routingOrder || 1}</p>
                        <p className="mt-1 text-xs font-semibold text-blue-700">Lines: {(member.supportNumbers?.length ? member.supportNumbers : [defaultSupportNumber]).join(', ')}</p>
                      </div>
                      <button type="button" onClick={() => editStaff(member)} className="rounded-md border border-gray-300 p-2 text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" aria-label={`Edit ${member.name}`}>
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {groups[group].length === 0 && <p className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">No staff in this group.</p>}
                </div>
              </section>
            ))}
          </div>

          <form onSubmit={saveStaff} className="h-fit rounded-xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex items-center gap-2">
              {form.staffId ? <PencilSquareIcon className="h-5 w-5 text-blue-700" /> : <PlusIcon className="h-5 w-5 text-blue-700" />}
              <h3 className="font-bold text-blue-950">{form.staffId ? 'Edit routing staff' : 'Add routing staff'}</h3>
            </div>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Name
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={100} required className={`${inputClass} mt-1`} />
            </label>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Receive calls using
              <select value={form.deliveryMode} onChange={(event) => setForm((current) => ({ ...current, deliveryMode: event.target.value }))} className={`${inputClass} mt-1`}>
                <option value="app">Chargerent Support iPhone app</option>
                <option value="phone">Personal phone fallback</option>
              </select>
            </label>
            {form.deliveryMode === 'app' ? (
              <label className="mt-4 block text-sm font-semibold text-gray-700">Chargerent account
                <select value={form.userUid} onChange={(event) => setForm((current) => ({ ...current, userUid: event.target.value }))} required className={`${inputClass} mt-1`}>
                  <option value="">Select an account</option>
                  {users.map((user) => <option key={user.uid} value={user.uid}>{user.displayName || user.name || user.username || user.email || user.uid}</option>)}
                </select>
              </label>
            ) : (
              <label className="mt-4 block text-sm font-semibold text-gray-700">Phone number
                <input value={form.phoneE164} onChange={(event) => setForm((current) => ({ ...current, phoneE164: event.target.value }))} placeholder="+1 818 996 0996" maxLength={40} required className={`${inputClass} mt-1 font-mono`} />
              </label>
            )}
            <label className="mt-4 block text-sm font-semibold text-gray-700">Incoming support number(s)
              <input value={form.supportNumbers} onChange={(event) => setForm((current) => ({ ...current, supportNumbers: event.target.value }))} placeholder="+1 917 993 9355" maxLength={240} required className={`${inputClass} mt-1 font-mono`} />
              <span className="mt-1 block text-xs font-normal text-gray-500">Separate multiple numbers with commas. Calls, call history, and call cases are limited to these lines.</span>
            </label>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Routing group
              <select value={form.routingGroup} onChange={(event) => setForm((current) => ({ ...current, routingGroup: event.target.value }))} className={`${inputClass} mt-1`}>
                <option value="primary">Primary</option>
                <option value="backup">Backup</option>
              </select>
            </label>
            <label className="mt-4 block text-sm font-semibold text-gray-700">Order within group
              <input type="number" min="1" max="100" value={form.routingOrder} onChange={(event) => setForm((current) => ({ ...current, routingOrder: event.target.value }))} required className={`${inputClass} mt-1`} />
            </label>
            <label className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-white p-3 text-sm font-semibold text-gray-700">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
              Include this staff member in routing
            </label>
            {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {success && <p className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircleIcon className="h-5 w-5" />{success}</p>}
            <div className="mt-5 flex justify-end gap-2">
              {form.staffId && <button type="button" onClick={() => setForm(emptyForm)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700">Cancel edit</button>}
              <button type="submit" disabled={readOnly || saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">
                {saving ? 'Saving…' : form.staffId ? 'Save changes' : 'Add staff'}
              </button>
            </div>
          </form>
        </div>

        <section className="mx-6 mb-6 rounded-xl border border-violet-200 bg-violet-50 p-5">
          <div className="flex items-start gap-3">
            <MusicalNoteIcon className="mt-0.5 h-6 w-6 text-violet-700" />
            <div>
              <h3 className="font-bold text-violet-950">MP3 voice prompts</h3>
              <p className="mt-1 text-sm text-violet-800">Upload an MP3 for any call phase. Twilio plays the recording when present and uses the built-in spoken prompt as a safe fallback.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {voicePrompts.map((definition) => {
              const uploaded = promptsByKey[definition.key];
              const mediaUrl = uploaded ? `${promptMediaBaseUrl}?prompt=${encodeURIComponent(definition.key)}&v=${encodeURIComponent(uploaded.revision || '')}` : '';
              return (
                <div key={definition.key} className="rounded-lg border border-violet-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{definition.label}</p>
                      <p className="mt-1 text-xs text-gray-500">{uploaded ? `${uploaded.fileName} · ${fileSizeLabel(uploaded.size)}` : `Text fallback: ${definition.fallback}`}</p>
                    </div>
                    <label className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-violet-300 bg-white px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100 ${readOnly || uploadingPrompt ? 'pointer-events-none opacity-50' : ''}`}>
                      <ArrowUpTrayIcon className="h-4 w-4" />
                      {uploadingPrompt === definition.key ? 'Uploading…' : uploaded ? 'Replace MP3' : 'Upload MP3'}
                      <input
                        type="file"
                        accept=".mp3,audio/mpeg,audio/mp3"
                        className="sr-only"
                        disabled={readOnly || Boolean(uploadingPrompt)}
                        onChange={(event) => uploadVoicePrompt(definition.key, event.target.files?.[0], event.target)}
                      />
                    </label>
                  </div>
                  {mediaUrl && <audio controls preload="none" src={mediaUrl} className="mt-3 h-9 w-full" />}
                </div>
              );
            })}
          </div>
          {promptError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{promptError}</p>}
          {promptSuccess && <p className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircleIcon className="h-5 w-5" />{promptSuccess}</p>}
        </section>
      </div>
    </div>
  );
}
