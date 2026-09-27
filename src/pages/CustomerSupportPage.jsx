import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase-config.js';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import RefundModal from '../components/UI/RefundModal.jsx';
import { RentalCard } from './RentalsPage.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import {
  CATEGORY_STYLES,
  STATUS_STYLES,
  SUPPORT_CATEGORIES,
  SUPPORT_REPLY_SENDERS,
  SUPPORT_REPLY_TEMPLATES,
  SUPPORT_STATUSES,
  buildSupportReply,
  defaultSupportReplySenderKey,
  linkedRentalPayload,
  normalizeCardLastFour,
  rankRentalMatches,
  supportCategoryLabel,
  supportCreatedTimestamp,
  supportDateLabel,
  supportRelativeTime,
  supportReplySendersForCategory,
  supportStatusLabel,
  supportTicketDisplayNumber,
  supportTicketMatchesStatusFilter,
  ticketMatchesSearch,
} from '../utils/supportTickets.js';

const SOURCE_FILTERS = [
  { value: '', label: 'All sources' },
  { value: 'website', label: 'Website' },
  { value: 'email', label: 'Email' },
  { value: 'chatbot', label: 'Chatbot' },
  { value: 'sms', label: 'SMS' },
  { value: 'phone', label: 'Phone' },
  { value: 'quo', label: 'Quo' },
  { value: 'manual', label: 'Manual' },
];
const EMPTY_PREVIEW_TICKETS = [];

const pill = 'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold';
const inputClass = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400';

const text = (value) => String(value ?? '').trim();

function sourceLabel(value) {
  return SOURCE_FILTERS.find((option) => option.value === value)?.label || value || 'Website';
}

function paymentMethodLabel(value) {
  return {
    physical_card: 'Physical card',
    apple_pay: 'Apple Pay',
    google_pay: 'Google Pay',
  }[value] || value;
}

function requestedAmountLabel(amount, currency = 'EUR') {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return '';
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(numericAmount);
  } catch {
    return `${currency || 'EUR'} ${numericAmount.toFixed(2)}`;
  }
}

function replyTemplateEvidenceWarning(templateType, rental, chargerLocation) {
  const refundStatus = String(rental?.refundStatus || rental?.refund_status || '').toLowerCase();
  const refundConfirmed = ['approved', 'refunded', 'succeeded', 'cancelled'].includes(refundStatus)
    || String(rental?.status || '').toLowerCase() === 'refunded';

  if (templateType === 'rental_found' && !rental) {
    return 'No rental is matched in the database. Verify the pre-filled rental details before sending.';
  }
  if (templateType === 'return_recorded' && !rental) {
    return 'No rental is matched in the database. Verify the pre-filled return confirmation before sending.';
  }
  if (templateType === 'charger_located' && (!rental || !chargerLocation)) {
    return 'The charger location is not confirmed in the database. Verify the pre-filled message before sending.';
  }
  if (templateType === 'refund_confirmed' && (!rental || !refundConfirmed)) {
    return 'The rental record does not confirm a refund. Send this pre-filled message only after verifying the processor result.';
  }
  return '';
}

function messageLabel(message) {
  if (message.type === 'internal_note') return 'Internal note';
  if (message.type === 'draft') return 'Saved draft';
  if (message.type === 'system') return 'Activity';
  if (message.direction === 'outbound' && message.deliveryStatus === 'sending') return 'Sending reply';
  if (message.direction === 'outbound' && message.deliveryStatus === 'failed') return 'Reply failed';
  if (message.direction === 'outbound') return 'Reply sent';
  if (message.channel === 'website') return 'Website form';
  return 'Customer message';
}

function displayTransactionId(rental) {
  return text(rental?.orderid || rental?.rawid || rental?.transactionid || rental?.transactionId || rental?.documentId);
}

function rentalRecordKey(rental) {
  return text(
    rental?.documentId ||
    rental?.rawid ||
    rental?.orderid ||
    rental?.transactionid ||
    rental?.transactionId,
  );
}

function rentalsReferToSameRecord(left, right) {
  const leftIds = new Set([
    left?.documentId,
    left?.rawid,
    left?.orderid,
    left?.transactionid,
    left?.transactionId,
  ].map(text).filter(Boolean));
  return [
    right?.documentId,
    right?.rawid,
    right?.orderid,
    right?.transactionid,
    right?.transactionId,
  ].map(text).filter(Boolean).some((value) => leftIds.has(value));
}

const defaultTranslate = (key) => key;

function resolveRefundTransactionId(rental) {
  return text(
    rental?.orderid ||
    rental?.transactionid ||
    rental?.transactionId ||
    rental?.paymentSessionId ||
    rental?.rawid,
  );
}

function resolveRefundGateway(rental, station) {
  return text(rental?.gateway || station?.hardware?.gateway);
}

function DetailRow({ label, value, mono = false }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`min-w-0 break-words font-medium text-gray-900 ${mono ? 'font-mono' : ''}`}>{String(value)}</dd>
    </div>
  );
}

function CopyDetailRow({ label, value }) {
  const [copyState, setCopyState] = useState('');
  if (value === undefined || value === null || value === '') return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopyState('copied');
      window.setTimeout(() => setCopyState(''), 1600);
    } catch (error) {
      console.error(`Unable to copy ${label.toLowerCase()}`, error);
      setCopyState('failed');
    }
  };

  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-gray-100 py-2 text-sm last:border-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 break-all font-medium text-gray-900">{String(value)}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white shadow-sm hover:bg-gray-50 ${copyState === 'copied' ? 'border-emerald-300 text-emerald-700' : copyState === 'failed' ? 'border-red-300 text-red-600' : 'border-gray-300 text-gray-600'}`}
          aria-label={`Copy ${label.toLowerCase()}`}
          title={copyState === 'copied' ? `${label} copied` : copyState === 'failed' ? `Copy ${label.toLowerCase()} failed — try again` : `Copy ${label.toLowerCase()}`}
        >
          {copyState === 'copied' ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
        </button>
      </dd>
    </div>
  );
}

function TicketCard({ ticket, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-4 text-left shadow-sm transition ${selected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-500/15' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {ticket.unread && <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />}
            <span className="font-mono text-xs font-semibold text-gray-500">{supportTicketDisplayNumber(ticket)}</span>
            <span className={`${pill} ${CATEGORY_STYLES[ticket.category] || CATEGORY_STYLES.general}`}>
              {supportCategoryLabel(ticket.category)}
            </span>
            {ticket.needsCaseMatch && (
              <span className={`${pill} border-amber-300 bg-amber-50 text-amber-800`}>Needs case match</span>
            )}
          </div>
          <p className="mt-2 truncate font-semibold text-gray-900">{ticket.subject || 'Website inquiry'}</p>
          <p className="mt-1 truncate text-sm text-gray-600">
            {ticket.customer?.name || ticket.customer?.email || 'Unknown contact'}
            {ticket.customer?.company ? ` · ${ticket.customer.company}` : ''}
          </p>
        </div>
        <span className={`${pill} shrink-0 ${STATUS_STYLES[ticket.status] || STATUS_STYLES.new}`}>
          {supportStatusLabel(ticket.status)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
        <span>{sourceLabel(ticket.source)}</span>
        <span>{supportRelativeTime(ticket.createdAt || ticket.createdAtIso)}</span>
      </div>
    </button>
  );
}

function SendConfirmation({ from, to, subject, onCancel, onConfirm, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="send-confirmation-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-blue-100 p-2 text-blue-700"><PaperAirplaneIcon className="h-5 w-5" /></div>
          <div>
            <h2 id="send-confirmation-title" className="text-lg font-bold text-gray-900">Send this reply?</h2>
            <p className="mt-1 text-sm text-gray-600">This sends an external email from {from?.email}.</p>
          </div>
        </div>
        <dl className="mt-5 rounded-lg border border-gray-200 bg-gray-50 px-4">
          <DetailRow label="From" value={from ? `${from.label} <${from.email}>` : ''} />
          <DetailRow label="To" value={to} />
          <DetailRow label="Subject" value={subject} />
        </dl>
        <p className="mt-3 text-sm text-gray-600">After Gmail confirms the send, the reply will be recorded in activity and the case will be marked Pending.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={primaryButton}>
            <PaperAirplaneIcon className="h-4 w-4" />
            {busy ? 'Sending…' : 'Send email'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerSupportPage({
  onNavigateToDashboard,
  onNavigateToChargers,
  onLogout,
  currentUser,
  allStationsData,
  t = defaultTranslate,
  onCommand,
  commandStatus,
  setCommandStatus,
  refundConfirmation,
  previewMode = false,
  previewTickets = EMPTY_PREVIEW_TICKETS,
  readOnlyMode = false,
}) {
  const [tickets, setTickets] = useState(() => previewMode ? previewTickets : []);
  const [loading, setLoading] = useState(!previewMode);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesError, setMessagesError] = useState('');
  const [rentalCandidates, setRentalCandidates] = useState([]);
  const [rentalsLoading, setRentalsLoading] = useState(false);
  const [rentalError, setRentalError] = useState('');
  const [selectedMatchKey, setSelectedMatchKey] = useState('');
  const [matchingRentalKey, setMatchingRentalKey] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyTemplate, setReplyTemplate] = useState('suggested');
  const [replyLanguage, setReplyLanguage] = useState('en');
  const [replySenderKey, setReplySenderKey] = useState('support');
  const [note, setNote] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [rentalToRefund, setRentalToRefund] = useState(null);
  const suggestionKeyRef = useRef('');

  useEffect(() => {
    if (previewMode) {
      setTickets(previewTickets);
      setLoading(false);
      return undefined;
    }
    const ticketsQuery = query(collection(db, 'supportTickets'), orderBy('createdAt', 'desc'), limit(300));
    return onSnapshot(ticketsQuery, (snapshot) => {
      const next = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .sort((left, right) => supportCreatedTimestamp(right) - supportCreatedTimestamp(left));
      setTickets(next);
      setLoading(false);
      setLoadError('');
    }, (error) => {
      console.error('Unable to load customer inquiries', error);
      setLoadError('Customer inquiries could not be loaded. Confirm that this account has administrator access.');
      setLoading(false);
    });
  }, [previewMode, previewTickets]);

  const filteredTickets = useMemo(() => tickets.filter((ticket) => (
    (!categoryFilter || ticket.category === categoryFilter) &&
    supportTicketMatchesStatusFilter(ticket, statusFilter) &&
    (!sourceFilter || ticket.source === sourceFilter) &&
    ticketMatchesSearch(ticket, search)
  )), [tickets, categoryFilter, statusFilter, sourceFilter, search]);

  useEffect(() => {
    if (selectedId && filteredTickets.some((ticket) => ticket.id === selectedId)) return;
    setSelectedId(filteredTickets[0]?.id || '');
  }, [filteredTickets, selectedId]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) || null,
    [tickets, selectedId],
  );
  const preferredReplyLanguage = selectedTicket?.details?.locale === 'fr' ? 'fr' : 'en';
  const replySenderOptions = useMemo(
    () => supportReplySendersForCategory(selectedTicket?.category),
    [selectedTicket?.category],
  );
  const replySender = replySenderOptions.find((sender) => sender.value === replySenderKey)
    || replySenderOptions[0]
    || SUPPORT_REPLY_SENDERS[0];
  const selectedTicketLastFour = normalizeCardLastFour(
    selectedTicket?.payment?.cardLastFour || selectedTicket?.details?.cardLastFour,
  );
  const selectedPreviewRentals = selectedTicket?.previewRentals;

  useEffect(() => {
    if (!selectedTicket?.id) {
      setMessages([]);
      return undefined;
    }
    if (previewMode) {
      setMessages(selectedTicket.previewMessages || []);
      setMessagesError('');
      return undefined;
    }
    const messagesQuery = query(
      collection(db, 'supportTickets', selectedTicket.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(300),
    );
    return onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
      setMessagesError('');
    }, (error) => {
      console.error('Unable to load inquiry messages', error);
      setMessagesError('Conversation history could not be loaded.');
    });
  }, [previewMode, selectedTicket]);

  useEffect(() => {
    let active = true;
    const loadMatches = async () => {
      if (selectedTicket?.category !== 'customer_support' || !/^\d{4}$/.test(selectedTicketLastFour)) {
        setRentalCandidates([]);
        setRentalError('');
        setRentalsLoading(false);
        return;
      }

      setRentalsLoading(true);
      setRentalError('');
      try {
        let rentals;
        if (previewMode) {
          rentals = selectedPreviewRentals || [];
        } else {
          const values = [selectedTicketLastFour, Number(selectedTicketLastFour)];
          const snapshots = await Promise.all(values.map((value) => getDocs(query(
            collection(db, 'rentals'),
            where('card_last4', '==', value),
            limit(100),
          ))));
          const merged = new Map();
          snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
            merged.set(document.id, { documentId: document.id, ...document.data() });
          }));
          rentals = [...merged.values()];
        }
        if (!active) return;
        setRentalCandidates(rentals);
      } catch (error) {
        if (!active) return;
        console.error('Unable to match support ticket to rentals', error);
        setRentalCandidates([]);
        setRentalError('Rental matching is temporarily unavailable. You can still open Rentals and search manually.');
      } finally {
        if (active) setRentalsLoading(false);
      }
    };
    loadMatches();
    return () => { active = false; };
  }, [previewMode, refundConfirmation, selectedPreviewRentals, selectedTicket?.category, selectedTicket?.id, selectedTicketLastFour]);

  const rentalMatches = useMemo(() => (
    rankRentalMatches(selectedTicket, rentalCandidates, allStationsData).slice(0, 8)
  ), [allStationsData, rentalCandidates, selectedTicket]);

  const linkedMatch = useMemo(() => {
    if (!selectedTicket?.linkedRental) return null;
    return rentalMatches.find((match) => (
      rentalsReferToSameRecord(match.rental, selectedTicket.linkedRental)
    )) || {
      rental: selectedTicket.linkedRental,
      chargerLocation: selectedTicket.linkedRental.chargerLocation || null,
      score: Number.POSITIVE_INFINITY,
    };
  }, [rentalMatches, selectedTicket?.linkedRental]);
  const persistedMatchKey = rentalRecordKey(selectedTicket?.linkedRental);

  useEffect(() => {
    setSelectedMatchKey(persistedMatchKey);
  }, [persistedMatchKey, selectedTicket?.id]);

  const selectedMatch = useMemo(() => rentalMatches.find((match) => (
    rentalRecordKey(match.rental) === selectedMatchKey
  )) || (
    linkedMatch && rentalRecordKey(linkedMatch.rental) === selectedMatchKey ? linkedMatch : null
  ), [linkedMatch, rentalMatches, selectedMatchKey]);
  const replyTemplateRental = selectedMatch?.rental || selectedTicket?.linkedRental || null;
  const replyTemplateChargerLocation = selectedMatch?.chargerLocation
    || selectedTicket?.linkedRental?.chargerLocation
    || null;
  const replyTemplateWarning = replyTemplateEvidenceWarning(
    replyTemplate,
    replyTemplateRental,
    replyTemplateChargerLocation,
  );
  const visibleRentalMatches = useMemo(() => (
    selectedMatch ? [selectedMatch] : rentalMatches
  ), [rentalMatches, selectedMatch]);

  useEffect(() => {
    setReplySenderKey(defaultSupportReplySenderKey(selectedTicket?.category));
  }, [selectedTicket?.category, selectedTicket?.id]);

  useEffect(() => {
    if (!selectedTicket) {
      suggestionKeyRef.current = '';
      setReplySubject('');
      setReplyBody('');
      return;
    }
    const suggestionKey = [
      selectedTicket.id,
      selectedTicket.category,
      displayTransactionId(selectedMatch?.rental || selectedTicket.linkedRental),
      selectedMatch?.rental?.refundStatus || selectedTicket.linkedRental?.refundStatus || '',
      selectedMatch?.chargerLocation?.stationId || selectedTicket.linkedRental?.chargerLocation?.stationId || '',
      preferredReplyLanguage,
    ].join(':');
    if (suggestionKeyRef.current === suggestionKey) return;
    suggestionKeyRef.current = suggestionKey;
    const suggestion = buildSupportReply(
      selectedTicket,
      selectedMatch,
      'suggested',
      defaultSupportReplySenderKey(selectedTicket.category),
      preferredReplyLanguage,
    );
    setReplyTemplate('suggested');
    setReplyLanguage(preferredReplyLanguage);
    setReplySubject(suggestion.subject);
    setReplyBody(suggestion.body);
  }, [preferredReplyLanguage, selectedTicket, selectedMatch]);

  useEffect(() => {
    if (previewMode || readOnlyMode || !selectedTicket?.id || selectedTicket.unread !== true) return;
    callFunctionWithAuth('support_updateTicket', {
      ticketId: selectedTicket.id,
      changes: { unread: false },
    }, { timeoutMs: 15000 }).catch((error) => {
      console.error('Unable to mark inquiry read', error);
    });
  }, [previewMode, readOnlyMode, selectedTicket?.id, selectedTicket?.unread]);

  const callSupportFunction = useCallback((name, data, options) => {
    if (previewMode) return Promise.resolve({ ok: true, preview: true });
    return callFunctionWithAuth(name, data, options);
  }, [previewMode]);

  const summary = useMemo(() => ({
    new: tickets.filter((ticket) => ticket.status === 'new').length,
    inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    pending: tickets.filter((ticket) => ticket.status === 'waiting_customer').length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
    open: tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length,
  }), [tickets]);

  const runAction = useCallback(async (key, action, successMessage) => {
    setBusyAction(key);
    setToast(null);
    try {
      await action();
      setToast({ type: 'success', message: successMessage });
      return true;
    } catch (error) {
      setToast({ type: 'error', message: error?.message || 'The request could not be completed.' });
      return false;
    } finally {
      setBusyAction('');
    }
  }, []);

  const updateTicket = useCallback((changes, successMessage = 'Ticket updated.') => {
    if (!selectedTicket?.id) return Promise.resolve();
    if (previewMode) {
      setTickets((current) => current.map((ticket) => (
        ticket.id === selectedTicket.id ? { ...ticket, ...changes } : ticket
      )));
    }
    return runAction('update', () => callSupportFunction('support_updateTicket', {
      ticketId: selectedTicket.id,
      changes,
    }, { timeoutMs: 20000 }), successMessage);
  }, [callSupportFunction, previewMode, runAction, selectedTicket?.id]);

  const handleMatchRental = useCallback(async (match) => {
    const nextMatchKey = rentalRecordKey(match.rental);
    setMatchingRentalKey(nextMatchKey);
    const saved = await updateTicket(
      { linkedRental: linkedRentalPayload(match) },
      'Rental matched to this inquiry. Other candidates are now hidden.',
    );
    if (saved) setSelectedMatchKey(nextMatchKey);
    setMatchingRentalKey('');
  }, [updateTicket]);

  const handleChangeMatch = useCallback(async () => {
    const previousMatchKey = selectedMatchKey;
    setSelectedMatchKey('');
    const saved = await updateTicket({ linkedRental: null }, 'Rental match cleared.');
    if (!saved) setSelectedMatchKey(previousMatchKey);
  }, [selectedMatchKey, updateTicket]);

  const handleSaveDraft = useCallback(() => {
    if (!selectedTicket?.id) return;
    return runAction('draft', () => callSupportFunction('support_saveDraft', {
      ticketId: selectedTicket.id,
      subject: replySubject,
      body: replyBody,
      senderKey: replySender.value,
    }, { timeoutMs: 20000 }), 'Reply draft saved.');
  }, [callSupportFunction, replyBody, replySender.value, replySubject, runAction, selectedTicket?.id]);

  const applyReplyTemplate = useCallback((templateType) => {
    if (!selectedTicket) return;
    const suggestion = buildSupportReply(
      selectedTicket,
      selectedMatch,
      templateType,
      replySender.value,
      replyLanguage,
    );
    setReplyTemplate(templateType);
    setReplySubject(suggestion.subject);
    setReplyBody(suggestion.body);
  }, [replyLanguage, replySender.value, selectedMatch, selectedTicket]);

  const handleReplySenderChange = useCallback((event) => {
    const nextSenderKey = event.target.value;
    const nextSender = replySenderOptions.find((sender) => sender.value === nextSenderKey);
    if (!selectedTicket || !nextSender) return;
    const suggestion = buildSupportReply(
      selectedTicket,
      selectedMatch,
      replyTemplate,
      nextSenderKey,
      replyLanguage,
    );
    setReplySenderKey(nextSenderKey);
    setReplySubject(suggestion.subject);
    setReplyBody(suggestion.body);
  }, [replyLanguage, replySenderOptions, replyTemplate, selectedMatch, selectedTicket]);

  const handleReplyLanguageChange = useCallback((nextLanguage) => {
    if (!selectedTicket || nextLanguage === replyLanguage) return;
    const suggestion = buildSupportReply(
      selectedTicket,
      selectedMatch,
      replyTemplate,
      replySender.value,
      nextLanguage,
    );
    setReplyLanguage(nextLanguage);
    setReplySubject(suggestion.subject);
    setReplyBody(suggestion.body);
  }, [replyLanguage, replySender.value, replyTemplate, selectedMatch, selectedTicket]);

  const handleSend = useCallback(() => {
    if (!selectedTicket?.id) return;
    return runAction('send', () => callSupportFunction('support_sendReply', {
      ticketId: selectedTicket.id,
      subject: replySubject,
      body: replyBody,
      senderKey: replySender.value,
    }, { timeoutMs: 45000, timeoutMessage: 'Sending the support reply took too long.' }), `Reply sent from ${replySender.email}, recorded in activity, and marked pending.`)
      .finally(() => setConfirmSend(false));
  }, [callSupportFunction, replyBody, replySender.email, replySender.value, replySubject, runAction, selectedTicket?.id]);

  const handleAddNote = useCallback(() => {
    if (!selectedTicket?.id || !note.trim()) return;
    runAction('note', () => callSupportFunction('support_addNote', {
      ticketId: selectedTicket.id,
      body: note,
    }, { timeoutMs: 20000 }), 'Internal note added.').then((saved) => {
      if (saved) setNote('');
    });
  }, [callSupportFunction, note, runAction, selectedTicket?.id]);

  const handleRefundClick = useCallback((rental) => {
    setRentalToRefund(rental);
    setShowRefundModal(true);
  }, []);

  const handleConfirmRefund = useCallback((amount) => {
    if (!rentalToRefund) return;
    if (readOnlyMode || typeof onCommand !== 'function') {
      setToast({ type: 'error', message: 'Refund actions are unavailable in this read-only localhost view.' });
      setShowRefundModal(false);
      setRentalToRefund(null);
      return;
    }

    const station = (allStationsData || []).find((item) => item.stationid === rentalToRefund.rentalStationid);
    const gateway = resolveRefundGateway(rentalToRefund, station);
    const transactionid = resolveRefundTransactionId(rentalToRefund);
    onCommand(rentalToRefund.rentalStationid, 'refund', null, null, null, {
      transactionid,
      orderId: transactionid,
      amount,
      gateway,
    });
    setCommandStatus?.({ state: 'sending', message: t('sending_command') });
    setShowRefundModal(false);
    setRentalToRefund(null);
  }, [allStationsData, onCommand, readOnlyMode, rentalToRefund, setCommandStatus, t]);

  const details = selectedTicket?.details || {};
  const customer = selectedTicket?.customer || {};

  return (
    <div className="min-h-screen bg-gray-100">
      <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus?.(null)} />
      <RefundModal
        isOpen={showRefundModal}
        onClose={() => {
          setShowRefundModal(false);
          setRentalToRefund(null);
        }}
        onConfirm={handleConfirmRefund}
        rental={rentalToRefund}
        t={t}
      />
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700"><ChatBubbleLeftRightIcon className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-gray-900">Customer Service</h1>
              <p className="truncate text-sm text-gray-500">Website inquiries, sales leads, and partnerships</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onNavigateToDashboard()} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to dashboard"><HomeIcon className="h-6 w-6" /></button>
            <button type="button" onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title="Log out">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        {toast && (
          <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border p-4 text-sm ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role={toast.type === 'error' ? 'alert' : 'status'}>
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} className="font-bold">×</button>
          </div>
        )}

        {readOnlyMode && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
            Live Firestore records are shown below. This localhost view is read-only until the Customer Service Cloud Functions are deployed.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['New', summary.new, 'new', 'border-amber-200 bg-amber-50 text-amber-900'],
            ['In progress', summary.inProgress, 'in_progress', 'border-blue-200 bg-blue-50 text-blue-900'],
            ['Pending', summary.pending, 'waiting_customer', 'border-violet-200 bg-violet-50 text-violet-900'],
            ['Resolved', summary.resolved, 'resolved', 'border-emerald-200 bg-emerald-50 text-emerald-900'],
            ['Open total', summary.open, 'open', 'border-sky-200 bg-sky-50 text-sky-900'],
          ].map(([label, count, filterValue, tone]) => (
            <button
              type="button"
              key={label}
              onClick={() => setStatusFilter(filterValue)}
              className={`rounded-lg border p-4 text-left transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${tone} ${statusFilter === filterValue ? 'ring-2 ring-current ring-offset-2' : ''}`}
              aria-pressed={statusFilter === filterValue}
              aria-label={`Show ${label.toLowerCase()} inquiries`}
            >
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-1 text-3xl font-bold">{count}</p>
            </button>
          ))}
        </div>

        <section className="mt-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {[{ value: '', label: 'All inquiries' }, ...SUPPORT_CATEGORIES].map((option) => (
                <button
                  type="button"
                  key={option.value || 'all'}
                  onClick={() => setCategoryFilter(option.value)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${categoryFilter === option.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
              <label className="relative block">
                <span className="sr-only">Search inquiries</span>
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, location, last four…" className={`${inputClass} pl-10`} />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClass} aria-label="Status filter">
                <option value="open">Open inquiries</option>
                {SUPPORT_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={inputClass} aria-label="Source filter">
                {SOURCE_FILTERS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        {loadError && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800" role="alert">{loadError}</div>}

        <div className="mt-5 grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="flex items-center justify-between px-1 text-sm text-gray-500">
              <span>{filteredTickets.length} inquiries</span>
              {loading && <span>Loading…</span>}
            </div>
            {filteredTickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} onClick={() => setSelectedId(ticket.id)} />
            ))}
            {!loading && filteredTickets.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No inquiries match these filters.</div>
            )}
          </aside>

          <section className="min-w-0">
            {!selectedTicket ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">Select an inquiry to review it.</div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-500">{supportTicketDisplayNumber(selectedTicket)}</span>
                        <span className={`${pill} ${CATEGORY_STYLES[selectedTicket.category] || CATEGORY_STYLES.general}`}>{supportCategoryLabel(selectedTicket.category)}</span>
                        <span className={`${pill} ${STATUS_STYLES[selectedTicket.status] || STATUS_STYLES.new}`}>{supportStatusLabel(selectedTicket.status)}</span>
                      </div>
                      <h2 className="mt-3 text-2xl font-bold text-gray-900">{selectedTicket.subject || 'Website inquiry'}</h2>
                      <p className="mt-1 text-sm text-gray-500">Received {supportDateLabel(selectedTicket.createdAt || selectedTicket.createdAtIso)} via {sourceLabel(selectedTicket.source)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updateTicket({ status: 'waiting_customer' }, 'Issue marked pending.')}
                        disabled={readOnlyMode || busyAction === 'update' || selectedTicket.status === 'waiting_customer'}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-violet-200 disabled:text-violet-300"
                      >
                        <ClockIcon className="h-5 w-5" />
                        {selectedTicket.status === 'waiting_customer' ? 'Pending' : busyAction === 'update' ? 'Updating…' : 'Mark pending'}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTicket({ status: 'resolved' }, 'Issue marked resolved.')}
                        disabled={readOnlyMode || busyAction === 'update' || selectedTicket.status === 'resolved'}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                      >
                        <CheckCircleIcon className="h-5 w-5" />
                        {selectedTicket.status === 'resolved' ? 'Resolved' : busyAction === 'update' ? 'Updating…' : 'Mark issue resolved'}
                      </button>
                    </div>
                  </div>

                  {selectedTicket.needsCaseMatch && (
                    <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                      <p>This email looked like a reply, but Gmail could not safely match it to an existing case. Review it before responding.</p>
                    </div>
                  )}

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 p-4">
                      <h3 className="font-semibold text-gray-900">Contact</h3>
                      <dl className="mt-2">
                        <DetailRow label="Name" value={customer.name} />
                        <CopyDetailRow label="Email" value={customer.email} />
                        <CopyDetailRow label="Phone" value={customer.phone} />
                        <DetailRow label="Company" value={customer.company} />
                        <DetailRow label="Role" value={customer.role} />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {customer.phone && <a href={`tel:${customer.phone}`} className={secondaryButton}><PhoneIcon className="h-4 w-4" />Call</a>}
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <h3 className="font-semibold text-gray-900">Submission details</h3>
                      <dl className="mt-2">
                        <DetailRow label="Request" value={selectedTicket.requestType} />
                        <DetailRow label="Issue" value={details.chatbotReasonLabel || details.chatbotReason} />
                        <DetailRow label="Issue details" value={details.chatbotReasonDetail} />
                        <DetailRow label="Station ID" value={details.chatbotStationId} mono />
                        <DetailRow label="Rental location" value={details.rentalLocation} />
                        <DetailRow label="Rental date" value={details.rentalDate} />
                        <DetailRow label="Card last four" value={selectedTicket.payment?.cardLastFour || details.cardLastFour} mono />
                        <DetailRow label="Payment method" value={paymentMethodLabel(details.paymentMethod)} />
                        <DetailRow label="Requested amount" value={requestedAmountLabel(details.amountRequested, details.amountCurrency)} />
                        <DetailRow label="Submitted language" value={details.submittedLanguage?.toUpperCase()} />
                        <DetailRow label="Chat session" value={details.chatbotSessionId} mono />
                        <DetailRow label="Venue" value={details.eventVenue || details.venueType} />
                        <DetailRow label="City / region" value={details.eventCity || details.venueCity || details.cityRegion} />
                        <DetailRow label="Event dates" value={[details.eventStartDate, details.eventEndDate].filter(Boolean).join(' – ')} />
                        <DetailRow label="Locations" value={details.numberOfLocations} />
                        <DetailRow label="Machines" value={details.machineCount} />
                        <DetailRow label="Location types" value={details.locationTypes} />
                        <DetailRow label="Partnership interest" value={details.partnershipInterest} />
                        <DetailRow label="How they heard" value={details.howHeard} />
                      </dl>
                    </div>
                  </div>
                  <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer message</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800">{selectedTicket.message || 'No additional message was provided.'}</p>
                  </div>
                </div>

                {selectedTicket.category === 'customer_support' && (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Rental investigation</h3>
                        <p className="mt-1 text-sm text-gray-500">Exact last-four lookup limited to three days before or after the stated rental date, ranked by date and location. Kiosk position and refund status remain separate evidence.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {rentalsLoading && <span className="text-sm text-gray-500">Matching…</span>}
                        {selectedMatch && (
                          <button
                            type="button"
                            onClick={handleChangeMatch}
                            disabled={readOnlyMode || busyAction === 'update'}
                            className={secondaryButton}
                          >
                            Change match
                          </button>
                        )}
                      </div>
                    </div>
                    {rentalError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{rentalError}</p>}
                    {!rentalsLoading && !rentalError && rentalMatches.length === 0 && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        <div className="flex items-start gap-2"><ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" /><p>No rental with these exact last four digits was found within three days before or after the stated date. The suggested reply asks for the Apple Pay Device Account Number or Google Wallet virtual-card last four.</p></div>
                      </div>
                    )}
                    {selectedMatch && (
                      <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        <CheckCircleIcon className="h-5 w-5 shrink-0" />
                        This rental is matched to the inquiry. Other candidates are hidden from this record.
                      </div>
                    )}
                    {visibleRentalMatches.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                        {visibleRentalMatches.map((match) => {
                          const isMatched = rentalRecordKey(match.rental) === selectedMatchKey;
                          return (
                            <RentalCard
                              key={match.rental.documentId || displayTransactionId(match.rental)}
                              rental={match.rental}
                              t={t}
                              onMatch={() => handleMatchRental(match)}
                              matchDisabled={readOnlyMode || busyAction === 'update'}
                              matchPending={rentalRecordKey(match.rental) === matchingRentalKey}
                              isMatched={isMatched}
                              onRefund={(currentUser?.features?.rentals || readOnlyMode) ? handleRefundClick : null}
                              refundDisabled={!isMatched || readOnlyMode || typeof onCommand !== 'function'}
                              canLock={false}
                              onNavigateToChargers={onNavigateToChargers}
                              onNavigateToDashboard={onNavigateToDashboard}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_22rem]">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Email reply</h3>
                        <p className="mt-1 text-sm text-gray-500">Suggested text is editable. Saving a draft does not send email.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="group" aria-label="Reply language">
                          {[
                            { value: 'en', label: 'EN', title: 'Write reply in English' },
                            { value: 'fr', label: 'FR', title: 'Rédiger la réponse en français' },
                          ].map((language) => (
                            <button
                              type="button"
                              key={language.value}
                              onClick={() => handleReplyLanguageChange(language.value)}
                              title={language.title}
                              aria-pressed={replyLanguage === language.value}
                              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${replyLanguage === language.value ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-blue-700'}`}
                            >
                              {language.label}
                            </button>
                          ))}
                        </div>
                        <EnvelopeIcon className="h-6 w-6 text-blue-600" />
                      </div>
                    </div>
                    <label className="mt-4 block text-sm font-semibold text-gray-700">From
                      <select
                        value={replySender.value}
                        onChange={handleReplySenderChange}
                        disabled={replySenderOptions.length < 2}
                        className={`${inputClass} mt-1 disabled:bg-gray-100 disabled:text-gray-600`}
                        aria-label="Reply sender"
                      >
                        {replySenderOptions.map((sender) => (
                          <option key={sender.value} value={sender.value}>{sender.label} — {sender.email}</option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Choose a reply template</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {SUPPORT_REPLY_TEMPLATES.map((template) => (
                          <button
                            type="button"
                            key={template.value}
                            onClick={() => applyReplyTemplate(template.value)}
                            title={`Use ${template.label} template`}
                            aria-pressed={replyTemplate === template.value}
                            className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${replyTemplate === template.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'}`}
                          >
                            {template.label}
                          </button>
                        ))}
                      </div>
                      {replyTemplateWarning && (
                        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900" role="status">
                          {replyTemplateWarning}
                        </p>
                      )}
                    </div>
                    <label className="mt-4 block text-sm font-semibold text-gray-700">Subject
                      <input value={replySubject} onChange={(event) => setReplySubject(event.target.value)} maxLength={300} className={`${inputClass} mt-1`} />
                    </label>
                    <label className="mt-4 block text-sm font-semibold text-gray-700">Message
                      <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} rows={13} maxLength={12000} className={`${inputClass} mt-1 resize-y font-sans leading-6`} />
                    </label>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={() => {
                        applyReplyTemplate('suggested');
                      }} className={secondaryButton}>Reset suggestion</button>
                      <button type="button" onClick={handleSaveDraft} disabled={readOnlyMode || busyAction === 'draft' || !replyBody.trim()} className={secondaryButton}>
                        <ClockIcon className="h-4 w-4" />
                        {busyAction === 'draft' ? 'Saving…' : 'Save draft'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmSend(true)}
                        disabled={readOnlyMode || !replyBody.trim() || !customer.email}
                        title="Review and send this reply"
                        className={primaryButton}
                      >
                        <PaperAirplaneIcon className="h-4 w-4" />Send reply
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h3 className="font-bold text-gray-900">Internal note</h3>
                    <p className="mt-1 text-sm text-gray-500">Visible only to dashboard administrators.</p>
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={8} maxLength={5000} placeholder="Record what you checked or what should happen next…" className={`${inputClass} mt-4 resize-y`} />
                    <button type="button" onClick={handleAddNote} disabled={readOnlyMode || !note.trim() || busyAction === 'note'} className={`${secondaryButton} mt-3 w-full`}>
                      {busyAction === 'note' ? 'Adding…' : 'Add internal note'}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-bold text-gray-900">Conversation and activity</h3>
                  {messagesError && <p className="mt-3 text-sm text-red-700">{messagesError}</p>}
                  <div className="mt-4 space-y-3">
                    {messages.map((message) => (
                      <div key={message.id} className={`rounded-lg border p-4 ${message.type === 'internal_note' ? 'border-amber-200 bg-amber-50' : message.type === 'draft' ? 'border-blue-200 bg-blue-50' : message.deliveryStatus === 'failed' ? 'border-red-200 bg-red-50' : message.direction === 'outbound' ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-gray-700">{messageLabel(message)}</span>
                          <span className="text-gray-500">{supportDateLabel(message.createdAt || message.createdAtIso)}</span>
                        </div>
                        {message.subject && <p className="mt-2 text-sm font-semibold text-gray-900">{message.subject}</p>}
                        {(message.from || message.to) && (
                          <p className="mt-1 text-xs text-gray-500">
                            {[message.from && `From ${message.from}`, message.to && `to ${message.to}`].filter(Boolean).join(' ')}
                          </p>
                        )}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{message.body || message.summary}</p>
                        {message.authorName && <p className="mt-2 text-xs text-gray-500">{message.authorName}</p>}
                      </div>
                    ))}
                    {messages.length === 0 && !messagesError && <p className="text-sm text-gray-500">No activity has been recorded yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {confirmSend && selectedTicket && (
        <SendConfirmation
          from={replySender}
          to={customer.email}
          subject={replySubject}
          onCancel={() => setConfirmSend(false)}
          onConfirm={handleSend}
          busy={busyAction === 'send'}
        />
      )}
    </div>
  );
}
