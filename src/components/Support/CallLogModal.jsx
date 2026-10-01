import { useEffect, useMemo, useState } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  PhoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase-config.js';
import { supportDateLabel } from '../../utils/supportTickets.js';

const filterClass = 'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function dispositionLabel(call) {
  const disposition = String(call.disposition || call.providerStatus || '').toLowerCase();
  if (disposition === 'callback_requested') return 'Callback requested';
  if (disposition === 'voicemail') return 'Voicemail';
  if (disposition === 'answered' || disposition === 'completed' || disposition === 'in-progress') return 'Answered';
  if (['unanswered', 'no-answer', 'busy', 'failed', 'canceled'].includes(disposition)) return 'Not answered';
  if (disposition === 'dialing' || disposition === 'initiated') return 'Dialing';
  return 'Ringing';
}

function dispositionTone(call) {
  const label = dispositionLabel(call);
  if (label === 'Callback requested') return 'border-amber-300 bg-amber-50 text-amber-900';
  if (label === 'Answered') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (label === 'Not answered' || label === 'Voicemail') return 'border-rose-300 bg-rose-50 text-rose-800';
  return 'border-blue-200 bg-blue-50 text-blue-800';
}

function durationLabel(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export default function CallLogModal({ onClose, onOpenCase }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState('');
  const [outcome, setOutcome] = useState('');

  useEffect(() => {
    const callQuery = query(collection(db, 'supportCallLogs'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(callQuery, (snapshot) => {
      setCalls(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
      setLoading(false);
      setError('');
    }, (snapshotError) => {
      console.error('Unable to load support call log', snapshotError);
      setError('The call log could not be loaded.');
      setLoading(false);
    });
  }, []);

  const filteredCalls = useMemo(() => calls.filter((call) => {
    if (direction && call.direction !== direction) return false;
    const label = dispositionLabel(call);
    if (outcome === 'callback' && label !== 'Callback requested') return false;
    if (outcome === 'answered' && label !== 'Answered') return false;
    if (outcome === 'missed' && !['Not answered', 'Voicemail'].includes(label)) return false;
    return true;
  }), [calls, direction, outcome]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="call-log-title">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <PhoneIcon className="h-6 w-6 text-blue-600" />
              <h2 id="call-log-title" className="text-xl font-black text-gray-900">Call log</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">The latest 100 inbound and staff-app outbound calls.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="Close call log">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-gray-200 bg-gray-50 px-6 py-3">
          <select value={direction} onChange={(event) => setDirection(event.target.value)} className={filterClass} aria-label="Call direction">
            <option value="">All directions</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)} className={filterClass} aria-label="Call outcome">
            <option value="">All outcomes</option>
            <option value="callback">Callback requested</option>
            <option value="answered">Answered</option>
            <option value="missed">Missed or voicemail</option>
          </select>
          <span className="self-center text-sm text-gray-500">{filteredCalls.length} calls</span>
        </div>

        <div className="overflow-y-auto p-6">
          {loading && <p className="text-sm text-gray-500">Loading calls…</p>}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
          <div className="space-y-3">
            {filteredCalls.map((call) => {
              const customerNumber = call.direction === 'outbound' ? call.to : call.from;
              const duration = durationLabel(call.dialCallDuration || call.callDuration);
              return (
                <article key={call.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">{call.direction === 'outbound' ? 'Outbound' : 'Inbound'} · {customerNumber || 'Unknown number'}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${dispositionTone(call)}`}>{dispositionLabel(call)}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{supportDateLabel(call.createdAt || call.createdAtIso)}{duration ? ` · ${duration}` : ''}</p>
                      {(call.staffName || call.acceptedByName) && <p className="mt-2 text-sm text-gray-600">Staff: {call.acceptedByName || call.staffName}</p>}
                      {call.callbackRequested && <p className="mt-2 text-sm font-semibold text-amber-800">Call back {call.callbackPhone || customerNumber}</p>}
                    </div>
                    {call.ticketId && (
                      <button type="button" onClick={() => onOpenCase(call.ticketId)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
                        Open case <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {!loading && !error && filteredCalls.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No calls match these filters.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
