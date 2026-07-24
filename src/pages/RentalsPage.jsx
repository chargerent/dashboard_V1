// src/pages/RentalsPage.jsx

import { useState, useMemo } from 'react';
import {
    CheckCircleIcon,
    ChevronDownIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { formatDateTime, formatDuration, formatDate } from '../utils/dateFormatter';
import { normalizeText, textEquals, textIncludes } from '../utils/text';
import {
    formatRentalChargeAmount,
    hasRefundRequest,
    isRefundedRental,
    isReturnedRentalStatus,
    isSuccessfulRefundStatus,
    normalizeRefundStatus,
} from '../utils/rentals.js';
import { isV2Kiosk } from '../utils/helpers.js';
import RefundModal from '../components/UI/RefundModal.jsx';
import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import CardBrandIcon from '../components/UI/CardBrandIcon.jsx';

const RENTALS_PER_PAGE = 30;

const resolveRefundTransactionId = (rental) => (
    String(
        rental?.orderid ||
        rental?.transactionid ||
        rental?.transactionId ||
        rental?.paymentSessionId ||
        rental?.rawid ||
        ''
    ).trim()
);

const resolveRefundGateway = (rental, station) => (
    String(rental?.gateway || station?.hardware?.gateway || '').trim()
);

const resolveDisplayTransactionId = (rental) => (
    String((
        normalizeRentalStatusKey(rental?.status) === 'declined'
            ? firstPresent(
                rental?.rawid,
                rental?.documentId,
                rental?.paymentAttemptId,
                rental?.transactionid,
                rental?.transactionId,
                rental?.paymentSessionId,
                rental?.orderid
            )
            : firstPresent(
                rental?.orderid,
                rental?.rawid,
                rental?.documentId,
                rental?.transactionid,
                rental?.transactionId,
                rental?.paymentSessionId
            )
    ) || '').trim()
);

const resolveCopyTransactionId = (rental) => (
    String((
        normalizeRentalStatusKey(rental?.status) === 'declined'
            ? firstPresent(
                rental?.rawid,
                rental?.documentId,
                rental?.paymentAttemptId,
                rental?.transactionid,
                rental?.transactionId,
                rental?.paymentSessionId,
                rental?.orderid
            )
            : firstPresent(
                rental?.transactionid,
                rental?.transactionId,
                rental?.paymentSessionId,
                rental?.rawid,
                rental?.documentId,
                rental?.paymentIntentId,
                rental?.orderid
            )
    ) || '').trim()
);

const formatTransactionId = (value) => {
    const transactionId = String(value || '').trim();

    if (transactionId.length <= 24) return transactionId;

    return `${transactionId.slice(0, 12)}...${transactionId.slice(-8)}`;
};

const normalizeRentalStatusKey = (status) => (
    normalizeText(status).replace(/[-\s]+/g, '_')
);

// Safely turn Firestore TS / string / ms into Date
const safeToDate = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp instanceof Date) return isNaN(timestamp.getTime()) ? null : timestamp;
    if (typeof timestamp.toDate === 'function') return timestamp.toDate();
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? null : d;
};

const firstPresent = (...values) => (
    values.find(value => value !== null && value !== undefined && String(value).trim() !== '')
);

const getRentalActivityTimestamp = (rental) => (
    firstPresent(
        rental?.rentalTime,
        rental?.failedAt,
        rental?.lastUpdate,
        rental?.returnTime,
        rental?.purchaseTime,
        rental?.purchasedAt,
        rental?.refundDate
    )
);

const getRentalActivityDate = (rental) => (
    safeToDate(getRentalActivityTimestamp(rental))
);

const copyToClipboard = async (value) => {
    const text = String(value || '').trim();
    if (!text) return false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the textarea fallback below.
        }
    }

    if (typeof document === 'undefined') return false;

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textArea);
    }
};

const formatLogTime = (timestamp) => {
    const date = safeToDate(timestamp);
    return date ? formatDateTime(date.toISOString()) : '';
};

const humanizeCode = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    return raw
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
};

const formatDetailParts = (...parts) => parts
    .filter(part => part !== null && part !== undefined && String(part).trim() !== '')
    .map(part => String(part));

const formatCentsAmount = (cents, symbol = '$') => {
    const value = Number(cents);
    if (!Number.isFinite(value)) return '';
    return `${symbol || '$'}${(value / 100).toFixed(2)}`;
};

const resolveProcessEventTitle = (entry, t) => {
    const event = normalizeText(firstPresent(entry?.event, entry?.type, entry?.title));
    const action = humanizeCode(firstPresent(entry?.action, entry?.paymentAction));

    if (event === 'apollo-authorization-created') return 'Apollo authorization created';
    if (event === 'apollo-payment-action-queued') return `Apollo ${action || 'payment'} queued`;
    if (event === 'apollo-payment-route-missing') return `Apollo ${action || 'payment'} route missing`;
    if (event === 'apollo-cancel-verified' || event === 'apollo-authorization-cancelled') return 'Apollo authorization cancelled';
    if (event === 'apollo-cancel-retry-needed') return 'Apollo cancel retry scheduled';
    if (event === 'apollo-cancel-failed' || event === 'apollo-authorization-cancel-retry-failed') return 'Apollo cancel failed';
    if (event === 'apollo-commit-confirmed') return 'Apollo commit confirmed';
    if (event === 'apollo-commit-failed') return 'Apollo commit failed';
    if (event === 'physical-return-after-purchase') return 'Physical return after purchase';

    return humanizeCode(firstPresent(entry?.title, entry?.event, entry?.type)) || t('process_log');
};

const resolveProcessEventStatus = (entry) => {
    const status = normalizeText(firstPresent(entry?.status, entry?.paymentActionStatus));
    const event = normalizeText(firstPresent(entry?.event, entry?.type, entry?.title));

    if (
        status.includes('fail') ||
        status.includes('error') ||
        status.includes('missing') ||
        event.includes('fail') ||
        event.includes('error') ||
        event.includes('missing')
    ) {
        return 'error';
    }

    if (
        status.includes('retry') ||
        status.includes('pending') ||
        event.includes('retry')
    ) {
        return 'warning';
    }

    if (status.includes('queued') || event.includes('queued') || event.includes('sent')) {
        return 'pending';
    }

    if (
        status.includes('cancelled') ||
        status.includes('committed') ||
        status.includes('confirmed') ||
        event.includes('verified') ||
        event.includes('confirmed') ||
        event.includes('cancelled')
    ) {
        return 'success';
    }

    return 'info';
};

const buildBackendProcessDetails = (entry, rental, t) => {
    const amountCents = firstPresent(entry?.amountCents, entry?.authorizedAmountCents, entry?.finalAmountCents);
    const hostReference = firstPresent(
        entry?.authorizationHostReference,
        entry?.aprivaHostTransactionId,
        entry?.host_transaction_id
    );

    return formatDetailParts(
        entry?.action ? `${t('actions')}: ${humanizeCode(entry.action)}` : '',
        entry?.status ? `${t('status')}: ${humanizeCode(entry.status)}` : '',
        entry?.state ? `State: ${entry.state}` : '',
        entry?.result ? `Result: ${entry.result}` : '',
        amountCents != null ? `${t('amount')}: ${formatCentsAmount(amountCents, rental.symbol)}` : '',
        entry?.statusCode != null ? `HTTP: ${entry.statusCode}` : '',
        entry?.lookupStatusCode != null ? `Lookup: ${entry.lookupStatusCode}` : '',
        entry?.terminalsn ? `Terminal: ${entry.terminalsn}` : '',
        entry?.rawid ? `Session: ${formatTransactionId(entry.rawid)}` : '',
        hostReference ? `Host ref: ${hostReference}` : '',
        entry?.note || entry?.reason || ''
    );
};

const hasAttemptSucceeded = (attempt) => (
    normalizeText(attempt?.reason) === 'dispensed' ||
    Number(attempt?.exitStatus) === 1
);

const getAttemptTime = (attempt) => (
    firstPresent(
        attempt?.respondedAt,
        attempt?.responseAt,
        attempt?.sentAt,
        attempt?.requestedAt,
        attempt?.createdAt,
        attempt?.at
    )
);

const buildRentalProcessLog = (rental, t) => {
    const entries = [];
    const backendProcessLog = Array.isArray(rental.processLog) ? rental.processLog : [];
    const hasBackendEvent = (eventName) => backendProcessLog.some(entry => (
        normalizeText(entry?.event) === eventName
    ));
    const addEntry = ({ title, timestamp, status = 'info', details = [] }) => {
        const time = safeToDate(timestamp)?.getTime();
        entries.push({
            id: `${entries.length}-${title}`,
            title,
            timestamp,
            displayTime: formatLogTime(timestamp),
            sortTime: Number.isFinite(time) ? time : null,
            order: entries.length,
            status,
            details: formatDetailParts(...details),
        });
    };

    const chargerSn = firstPresent(rental.sn, rental.chargerid);
    const displayTransactionId = resolveDisplayTransactionId(rental);
    const fullTransactionId = resolveCopyTransactionId(rental);
    const initialStatus = normalizeRentalStatusKey(rental.status);
    const isDeclined = initialStatus === 'declined';
    const rentalDetails = formatDetailParts(
        fullTransactionId ? `${t('order_id')}: ${fullTransactionId}` : '',
        isDeclined && rental.paymentAttemptId ? `Payment attempt: ${rental.paymentAttemptId}` : '',
        rental.card_last4 ? `${t('card')}: ${rental.card_last4}` : '',
        !isDeclined && chargerSn ? `${t('charger_sn')}: ${chargerSn}` : '',
        rental.rentalStationid ? `${t('station')}: ${rental.rentalStationid}` : '',
        !isDeclined && rental.rentalModuleid ? `M: ${rental.rentalModuleid}` : '',
        !isDeclined && rental.rentalSlotid != null ? `S: ${rental.rentalSlotid}` : '',
        !isDeclined && rental.rentPower != null ? `${rental.rentPower}%` : '',
        rental.gateway ? `Gateway: ${rental.gateway}` : '',
        rental.paymentStatus ? `Payment: ${humanizeCode(rental.paymentStatus)}` : '',
        displayTransactionId && fullTransactionId && displayTransactionId !== fullTransactionId ? `Short ID: ${displayTransactionId}` : ''
    );

    addEntry({
        title: initialStatus === 'declined' ? t('payment_declined') : t('rental_created'),
        timestamp: initialStatus === 'declined'
            ? firstPresent(rental.declinedAt, rental.rentalTime, rental.lastUpdate)
            : firstPresent(rental.rentalTime, rental.failedAt, rental.lastUpdate),
        status: initialStatus === 'pending' ? 'pending' : 'info',
        details: rentalDetails,
    });

    const authorizationReference = firstPresent(
        rental.authorizationHostReference,
        rental.aprivaHostTransactionId,
        rental.host_transaction_id
    );
    if ((authorizationReference || rental.authorizedAmountCents || rental.terminalTxnId) && !hasBackendEvent('apollo-authorization-created')) {
        addEntry({
            title: 'Apollo authorization created',
            timestamp: firstPresent(rental.paymentAuthorizedAt, rental.rentalTime),
            status: 'info',
            details: formatDetailParts(
                authorizationReference ? `Host ref: ${authorizationReference}` : '',
                rental.terminalTxnId ? `Terminal txn: ${rental.terminalTxnId}` : '',
                rental.authorizedAmountCents != null ? `${t('amount')}: ${formatCentsAmount(rental.authorizedAmountCents, rental.symbol)}` : '',
                rental.paymentTerminalSn || rental.terminalsn ? `Terminal: ${firstPresent(rental.paymentTerminalSn, rental.terminalsn)}` : ''
            ),
        });
    }

    const attempts = Array.isArray(rental.vendAttempts) ? rental.vendAttempts : [];
    attempts.forEach((attempt, index) => {
        const succeeded = hasAttemptSucceeded(attempt);
        const attemptNumber = firstPresent(attempt.attemptNumber, index + 1);
        const requestedSn = firstPresent(attempt.requestedSn, attempt.sn, attempt.chargerid);
        const responseSn = firstPresent(attempt.responseSn, attempt.batterySN);
        const moduleId = firstPresent(attempt.moduleid, attempt.module, attempt.requestedModuleid);
        const slotId = firstPresent(attempt.requestedSlotid, attempt.slotid, attempt.slot);
        const reason = humanizeCode(firstPresent(attempt.reason, attempt.status));

        addEntry({
            title: `${t('attempt')} ${attemptNumber}: ${succeeded ? t('charger_dispensed') : t('dispense_failed')}`,
            timestamp: getAttemptTime(attempt),
            status: succeeded ? 'success' : 'error',
            details: formatDetailParts(
                requestedSn ? `${t('requested')}: ${requestedSn}` : '',
                responseSn && String(responseSn) !== String(requestedSn) ? `${t('response')}: ${responseSn}` : '',
                attempt.stationid ? `${t('station')}: ${attempt.stationid}` : '',
                moduleId ? `M: ${moduleId}` : '',
                slotId != null ? `S: ${slotId}` : '',
                attempt.exitStatus != null ? `${t('exit_status')}: ${attempt.exitStatus}` : '',
                attempt.solenoidStatus != null ? `${t('solenoid_status')}: ${attempt.solenoidStatus}` : '',
                reason ? `${t('reason')}: ${reason}` : ''
            ),
        });
    });

    if (attempts.length === 0 && rental.exitStatus != null) {
        const succeeded = Number(rental.exitStatus) === 1;
        addEntry({
            title: succeeded ? t('charger_dispensed') : t('dispense_failed'),
            timestamp: firstPresent(rental.popupConfirmedAt, rental.vendTime, rental.rentedAt, rental.rentalTime),
            status: succeeded ? 'success' : 'error',
            details: formatDetailParts(
                chargerSn ? `${t('charger_sn')}: ${chargerSn}` : '',
                rental.exitStatus != null ? `${t('exit_status')}: ${rental.exitStatus}` : '',
                rental.solenoidStatus != null ? `${t('solenoid_status')}: ${rental.solenoidStatus}` : ''
            ),
        });
    }

    const currentAttempt = rental.currentVendAttempt;
    if (currentAttempt && normalizeText(rental.status) === 'pending') {
        addEntry({
            title: `${t('attempt')} ${firstPresent(currentAttempt.attemptNumber, attempts.length + 1)}: ${t('dispense_requested')}`,
            timestamp: firstPresent(currentAttempt.sentAt, currentAttempt.createdAt, rental.rentalTime),
            status: normalizeText(rental.vendState) === 'retrying' ? 'warning' : 'pending',
            details: formatDetailParts(
                currentAttempt.sn ? `${t('charger_sn')}: ${currentAttempt.sn}` : '',
                currentAttempt.moduleid ? `M: ${currentAttempt.moduleid}` : '',
                currentAttempt.slotid != null ? `S: ${currentAttempt.slotid}` : '',
                currentAttempt.batteryLevel != null ? `${currentAttempt.batteryLevel}%` : ''
            ),
        });
    } else if (normalizeText(rental.status) === 'pending' && attempts.length === 0 && rental.exitStatus == null) {
        addEntry({
            title: t('waiting_for_vend_confirmation'),
            timestamp: rental.rentalTime,
            status: 'pending',
            details: formatDetailParts(
                rental.rentalModuleid ? `M: ${rental.rentalModuleid}` : '',
                rental.rentalSlotid != null ? `S: ${rental.rentalSlotid}` : '',
                rental.rentPower != null ? `${rental.rentPower}%` : ''
            ),
        });
    }

    if (rental.lastVendFailure && attempts.length === 0) {
        const failure = rental.lastVendFailure;
        addEntry({
            title: t('dispense_failed'),
            timestamp: firstPresent(failure.respondedAt, failure.failedAt, rental.lastUpdate),
            status: 'error',
            details: formatDetailParts(
                failure.requestedSn ? `${t('requested')}: ${failure.requestedSn}` : '',
                failure.responseSn ? `${t('response')}: ${failure.responseSn}` : '',
                failure.exitStatus != null ? `${t('exit_status')}: ${failure.exitStatus}` : '',
                failure.solenoidStatus != null ? `${t('solenoid_status')}: ${failure.solenoidStatus}` : '',
                firstPresent(failure.reason, rental.lastVendFailureReason)
                    ? `${t('reason')}: ${humanizeCode(firstPresent(failure.reason, rental.lastVendFailureReason))}`
                    : ''
            ),
        });
    }

    const rentalStatus = normalizeRentalStatusKey(rental.status);
    const hasSuccessfulVend = (
        attempts.some(hasAttemptSucceeded) ||
        (attempts.length === 0 && Number(rental.exitStatus) === 1)
    );
    const hasCompletedVend = (
        hasSuccessfulVend ||
        rentalStatus === 'rented' ||
        rentalStatus === 'purchased' ||
        isReturnedRentalStatus(rental.status) ||
        Boolean(rental.returnTime)
    );
    const finalFailureReason = firstPresent(rental.failureReason, rental.lastVendFailureReason);
    const shouldShowFinalFailure = rentalStatus === 'vend_failed' || (finalFailureReason && !hasCompletedVend);

    if (shouldShowFinalFailure) {
        addEntry({
            title: t('final_vend_failure'),
            timestamp: firstPresent(rental.failedAt, rental.lastUpdate, rental.rentalTime),
            status: 'error',
            details: finalFailureReason ? [`${t('reason')}: ${humanizeCode(finalFailureReason)}`] : [],
        });
    }

    if (normalizeText(rental.status) === 'purchased') {
        addEntry({
            title: t('purchase_recorded'),
            timestamp: firstPresent(rental.purchaseTime, rental.purchasedAt, rental.returnTime, rental.rentalTime),
            status: 'success',
            details: formatDetailParts(formatRentalChargeAmount(rental)),
        });
    }

    if (rental.returnTime) {
        addEntry({
            title: t('rental_returned'),
            timestamp: rental.returnTime,
            status: 'success',
            details: formatDetailParts(
                rental.returnStationid ? `${t('station')}: ${rental.returnStationid}` : '',
                rental.returnModuleid ? `M: ${rental.returnModuleid}` : '',
                rental.returnSlotid != null ? `S: ${rental.returnSlotid}` : '',
                rental.returnType ? humanizeCode(rental.returnType) : ''
            ),
        });
    }

    if (rentalStatus === 'rented' && !rental.returnTime) {
        addEntry({
            title: t('in_use'),
            timestamp: firstPresent(rental.lastUpdate, rental.rentalTime),
            status: 'pending',
            details: formatDetailParts(
                rental.rentalStationid ? `${t('station')}: ${rental.rentalStationid}` : '',
                rental.rentalModuleid ? `M: ${rental.rentalModuleid}` : '',
                rental.rentalSlotid != null ? `S: ${rental.rentalSlotid}` : '',
                chargerSn ? `${t('charger_sn')}: ${chargerSn}` : ''
            ),
        });
    }

    if (rental.refundStatus) {
        const status = isSuccessfulRefundStatus(rental.refundStatus) ? 'success' : 'warning';
        addEntry({
            title: t('refund_recorded'),
            timestamp: firstPresent(rental.refundDate, rental.lastUpdate, rental.returnTime),
            status,
            details: formatDetailParts(
                humanizeCode(rental.refundStatus),
                rental.refundAmount != null
                    ? `${t('amount')}: ${rental.refundAmount === 'full'
                        ? t('full_refund')
                        : `${rental.symbol || ''}${Number(rental.refundAmount)?.toFixed(2)}`}`
                    : ''
            ),
        });
    }

    if (rental.paymentAction && !hasBackendEvent('apollo-payment-action-queued')) {
        addEntry({
            title: `Apollo ${humanizeCode(rental.paymentAction)} queued`,
            timestamp: firstPresent(rental.paymentActionQueuedAt, rental.returnTime, rental.paymentUpdatedAt),
            status: normalizeText(rental.paymentActionStatus) === 'queued' ? 'pending' : resolveProcessEventStatus({
                status: rental.paymentActionStatus,
                event: `apollo-${rental.paymentAction}`,
            }),
            details: formatDetailParts(
                rental.paymentActionReason ? `${t('reason')}: ${humanizeCode(rental.paymentActionReason)}` : '',
                rental.paymentActionStatus ? `${t('status')}: ${humanizeCode(rental.paymentActionStatus)}` : '',
                rental.paymentAmountCents != null ? `${t('amount')}: ${formatCentsAmount(rental.paymentAmountCents, rental.symbol)}` : '',
                rental.paymentTerminalSn || rental.terminalsn ? `Terminal: ${firstPresent(rental.paymentTerminalSn, rental.terminalsn)}` : '',
                rental.paymentSessionId || rental.rawid ? `Session: ${formatTransactionId(firstPresent(rental.paymentSessionId, rental.rawid))}` : ''
            ),
        });
    }

    const hasCancelEvent = backendProcessLog.some(entry => normalizeText(entry?.event).includes('cancel'));
    if ((rental.cpsCancelStatusCode || rental.cpsCancelLookupStatusCode || rental.cpsCancelState) && !hasCancelEvent) {
        addEntry({
            title: rental.cpsCancelConfirmed ? 'Apollo authorization cancelled' : 'Apollo cancel failed',
            timestamp: firstPresent(rental.cpsCancelVerifiedAt, rental.paymentUpdatedAt, rental.cpsCancelLastAttemptAt),
            status: rental.cpsCancelConfirmed ? 'success' : 'error',
            details: formatDetailParts(
                rental.cpsCancelState ? `State: ${rental.cpsCancelState}` : '',
                rental.cpsCancelResult ? `Result: ${rental.cpsCancelResult}` : '',
                rental.cpsCancelStatusCode != null ? `HTTP: ${rental.cpsCancelStatusCode}` : '',
                rental.cpsCancelLookupStatusCode != null ? `Lookup: ${rental.cpsCancelLookupStatusCode}` : '',
                rental.paymentActionError || ''
            ),
        });
    }

    const hasCommitEvent = backendProcessLog.some(entry => normalizeText(entry?.event).includes('commit'));
    if ((rental.cpsCommitStatusCode || rental.cpsCommitState) && !hasCommitEvent) {
        addEntry({
            title: rental.cpsCommitConfirmed ? 'Apollo commit confirmed' : 'Apollo commit failed',
            timestamp: firstPresent(rental.cpsCommitResponseAt, rental.paymentUpdatedAt, rental.purchaseCompletedAt),
            status: rental.cpsCommitConfirmed ? 'success' : 'error',
            details: formatDetailParts(
                rental.cpsCommitState ? `State: ${rental.cpsCommitState}` : '',
                rental.cpsCommitResult ? `Result: ${rental.cpsCommitResult}` : '',
                rental.cpsCommitStatusCode != null ? `HTTP: ${rental.cpsCommitStatusCode}` : '',
                rental.paymentAmountCents != null ? `${t('amount')}: ${formatCentsAmount(rental.paymentAmountCents, rental.symbol)}` : '',
                rental.paymentActionError || ''
            ),
        });
    }

    backendProcessLog.forEach((entry) => {
        addEntry({
            title: resolveProcessEventTitle(entry, t),
            timestamp: firstPresent(entry?.timestamp, entry?.time, entry?.createdAt, rental.paymentUpdatedAt, rental.lastUpdate),
            status: resolveProcessEventStatus(entry),
            details: buildBackendProcessDetails(entry, rental, t),
        });
    });

    return entries.sort((left, right) => {
        if (left.sortTime !== null && right.sortTime !== null) {
            return left.sortTime - right.sortTime || left.order - right.order;
        }

        return left.order - right.order;
    });
};

const hasRentalLogError = (rental) => (
    buildRentalProcessLog(rental, key => key).some(entry => entry.status === 'error')
);

const logStatusStyles = {
    success: {
        icon: CheckCircleIcon,
        iconClass: 'text-green-600',
        rowClass: 'border-green-100 bg-green-50',
    },
    error: {
        icon: ExclamationTriangleIcon,
        iconClass: 'text-red-600',
        rowClass: 'border-red-100 bg-red-50',
    },
    warning: {
        icon: ExclamationTriangleIcon,
        iconClass: 'text-orange-600',
        rowClass: 'border-orange-100 bg-orange-50',
    },
    pending: {
        icon: ClockIcon,
        iconClass: 'text-blue-600',
        rowClass: 'border-blue-100 bg-blue-50',
    },
    info: {
        icon: InformationCircleIcon,
        iconClass: 'text-gray-500',
        rowClass: 'border-gray-100 bg-gray-50',
    },
};

const RentalProcessLog = ({ rental, t }) => {
    const entries = buildRentalProcessLog(rental, t);
    const errorCount = entries.filter(entry => entry.status === 'error').length;

    return (
        <details className="mt-4 border-t border-gray-100 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-gray-700 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                    <ClockIcon className="h-4 w-4 text-gray-500" />
                    {t('process_log')}
                    <span className="text-gray-400 font-normal">
                        {entries.length} {t(entries.length === 1 ? 'log_entry' : 'log_entries')}
                    </span>
                </span>
                <span className="flex items-center gap-2">
                    {errorCount > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            {errorCount} {t(errorCount === 1 ? 'error' : 'errors')}
                        </span>
                    )}
                    <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                </span>
            </summary>
            <div className="mt-3 space-y-2">
                {entries.map(entry => {
                    const styles = logStatusStyles[entry.status] || logStatusStyles.info;
                    const StatusIcon = styles.icon;
                    return (
                        <div key={entry.id} className={`rounded-md border px-3 py-2 ${styles.rowClass}`}>
                            <div className="flex items-start gap-2">
                                <StatusIcon className={`mt-0.5 h-4 w-4 flex-none ${styles.iconClass}`} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                        <p className="text-xs font-semibold text-gray-800">{entry.title}</p>
                                        {entry.displayTime && (
                                            <p className="text-[10px] font-medium text-gray-500">{entry.displayTime}</p>
                                        )}
                                    </div>
                                    {entry.details.length > 0 && (
                                        <p className="mt-1 break-words text-[11px] leading-4 text-gray-600">
                                            {entry.details.join(' • ')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </details>
    );
};

const RentalCard = ({ rental, t, onRefund, onLockClick, canLock, onNavigateToChargers, onNavigateToDashboard }) => {
    const [copiedTransaction, setCopiedTransaction] = useState(false);
    const displayTransactionId = resolveDisplayTransactionId(rental);
    const copyTransactionId = resolveCopyTransactionId(rental);
    const chargerId = String(firstPresent(rental.sn, rental.chargerid) || '').trim();
    const rentalActivityTimestamp = getRentalActivityTimestamp(rental);
    const normalizedRefundStatus = normalizeRefundStatus(rental.refundStatus);
    const rentalStatusKey = normalizeRentalStatusKey(rental.status);
    const isDeclined = rentalStatusKey === 'declined';
    const returnTimeLabel = rental.returnTime
        ? formatDateTime(rental.returnTime)
        : (rentalStatusKey === 'vend_failed' ? 'N/A' : t('in_use'));
    const statusClass = rentalStatusKey === 'rented' ? 'bg-blue-100 text-blue-800' :
                        rentalStatusKey === 'purchased' ? 'bg-purple-100 text-purple-800' :
                        rentalStatusKey === 'refunded' ? 'bg-green-100 text-green-800' :
                        rentalStatusKey === 'pending' ? 'bg-orange-100 text-orange-800' :
                        rentalStatusKey === 'declined' ? 'bg-gray-100 text-gray-800' :
                        rentalStatusKey === 'vend_failed' ? 'bg-red-100 text-red-800' :
                        rentalStatusKey === 'returned' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';

    const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
    const isShortRental = isReturnedRentalStatus(rental.status) && rental.rentalPeriod && rental.rentalPeriod < FIVE_MINUTES_IN_MS;
    const cardBgClass = isShortRental ? 'bg-red-50' : 'bg-white';

    const refundStatusClass = normalizedRefundStatus === 'pending' ? 'text-orange-700' :
                              isSuccessfulRefundStatus(normalizedRefundStatus) ? 'text-green-700' :
                              'text-gray-700';

    const lockButtonColor = rental.isLocked ? 'text-red-600 bg-red-100' : 'text-gray-400 hover:text-red-600 hover:bg-red-100';

    const handleCopyTransactionId = async () => {
        if (!copyTransactionId) return;

        const didCopy = await copyToClipboard(copyTransactionId);
        if (!didCopy) return;

        setCopiedTransaction(true);
        if (typeof window !== 'undefined') {
            window.setTimeout(() => setCopiedTransaction(false), 1400);
        }
    };

    const handleChargerClick = () => {
        if (!chargerId || !onNavigateToChargers) return;
        onNavigateToChargers(chargerId);
    };

    const handleStationClick = () => {
        if (!rental.rentalStationid || !onNavigateToDashboard) return;
        onNavigateToDashboard(rental.rentalStationid);
    };

    return (
        <div className={`${cardBgClass} shadow-md rounded-lg p-4 flex flex-col justify-between`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-sm text-gray-800 truncate" title={`${rental.rentalStationid} - ${rental.rentalLocation}`}>
                        <button
                            type="button"
                            onClick={handleStationClick}
                            className="text-blue-700 transition-colors hover:text-blue-900 hover:underline"
                            title={`${t('go_to_kiosk')}: ${rental.rentalStationid}`}
                            aria-label={`${t('go_to_kiosk')}: ${rental.rentalStationid}`}
                        >
                            {rental.rentalStationid}
                        </button>
                        {' - '}{rental.rentalLocation}
                    </h3>
                    <p className="text-xs text-gray-500">{rental.rentalPlace || ' '}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClass}`}>
                        {t(rentalStatusKey || rental.status)}
                    </div>
                </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
                <div>
                    <p className="text-gray-500">{t('order_id')}</p>
                    <button
                        type="button"
                        onClick={handleCopyTransactionId}
                        disabled={!copyTransactionId}
                        className={`block max-w-full truncate text-left font-mono transition-colors disabled:cursor-default disabled:text-gray-800 disabled:hover:no-underline ${copiedTransaction ? 'text-green-700' : 'text-blue-700 hover:text-blue-900 hover:underline'}`}
                        title={copyTransactionId ? `${copiedTransaction ? t('copied_transaction_id') : t('copy_transaction_id')}: ${copyTransactionId}` : ''}
                        aria-label={copyTransactionId ? `${t('copy_transaction_id')}: ${copyTransactionId}` : t('order_id')}
                    >
                        {formatTransactionId(displayTransactionId || copyTransactionId)}
                    </button>
                </div>
                {!isDeclined && (
                    <div>
                        <p className="text-gray-500">{t('charger_sn')}</p>
                        {chargerId && onNavigateToChargers ? (
                            <button
                                type="button"
                                onClick={handleChargerClick}
                                className="block max-w-full truncate text-left font-mono text-blue-700 transition-colors hover:text-blue-900 hover:underline"
                                title={`${t('open_charger')}: ${chargerId}`}
                                aria-label={`${t('open_charger')}: ${chargerId}`}
                            >
                                {chargerId}
                            </button>
                        ) : (
                            <p className="font-mono text-gray-800 truncate" title={chargerId}>{chargerId}</p>
                        )}
                    </div>
                )}
                <div>
                    <p className="text-gray-500">{t('card')}</p>
                    <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate font-mono text-gray-800">{rental.card_last4}</p>
                        <CardBrandIcon rental={rental} />
                    </div>
                </div>
                <div>
                    <p className="text-gray-500">{t('rental')}</p>
                    <p className="text-gray-800">{formatDateTime(rentalActivityTimestamp)}</p>
                    {!isDeclined && rental.rentalModuleid && rental.rentalSlotid && (
                        <p className="text-gray-600 text-[10px]">
                            M: {rental.rentalModuleid} S: {rental.rentalSlotid} @ {rental.rentPower}%
                        </p>
                    )}
                </div>
                {!isDeclined && (
                    <>
                        <div>
                            <p className="text-gray-500">{t('return')}</p>
                            <p className="text-gray-800">{returnTimeLabel}</p>
                            {rental.returnModuleid && rental.returnSlotid && (
                                <p className="text-gray-600 text-[10px]">
                                    M: {rental.returnModuleid} S: {rental.returnSlotid} @ {rental.returnPower}%
                                </p>
                            )}
                        </div>
                        <div>
                            <p className="text-gray-500">{t('period')}</p>
                            <p className="text-gray-800">{formatDuration(rental.rentalTime, rental.returnTime)}</p>
                        </div>
                    </>
                )}
                <div>
                    <p className="text-gray-500">{t('amount')}</p>
                    <p className="font-mono text-base font-bold text-gray-800">
                        {(isReturnedRentalStatus(rental.status) || rentalStatusKey === 'purchased')
                            ? formatRentalChargeAmount(rental)
                            : ''}
                    </p>
                </div>
                {rental.returnType === 'sweep-return' && (
                    <div className="col-span-2 flex justify-end items-end" title={t('sweep-return')}>
                        <svg fill="currentColor" className="h-5 w-5 text-gray-400" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                            <path d="M46.4375 -0.03125C46.269531 -0.0390625 46.097656 -0.0234375 45.9375 0C45.265625 0.09375 44.6875 0.421875 44.28125 1.03125L44.25 1.09375L44.21875 1.125L35.65625 17.21875C34.691406 16.859375 33.734375 16.648438 32.84375 16.625C31.882813 16.601563 30.976563 16.75 30.15625 17.09375C28.574219 17.753906 27.378906 19.046875 26.59375 20.6875C26.558594 20.738281 26.527344 20.789063 26.5 20.84375C26.496094 20.851563 26.503906 20.867188 26.5 20.875C26.488281 20.894531 26.476563 20.917969 26.46875 20.9375C26.457031 20.976563 26.445313 21.019531 26.4375 21.0625C25.894531 22.417969 25.269531 23.636719 24.5625 24.71875C24.554688 24.730469 24.539063 24.738281 24.53125 24.75C24.441406 24.828125 24.367188 24.925781 24.3125 25.03125C24.308594 25.039063 24.316406 25.054688 24.3125 25.0625C24.277344 25.113281 24.246094 25.164063 24.21875 25.21875C21.832031 28.636719 18.722656 30.695313 15.78125 31.96875C11.773438 33.703125 7.9375 33.886719 7.09375 33.8125C6.691406 33.773438 6.304688 33.976563 6.113281 34.332031C5.925781 34.6875 5.964844 35.125 6.21875 35.4375C17.613281 49.5 34.375 50 34.375 50C34.574219 50.003906 34.769531 49.949219 34.9375 49.84375C34.9375 49.84375 37.007813 48.53125 39.5 45.40625C41.371094 43.058594 43.503906 39.664063 45.34375 34.96875C45.355469 34.957031 45.363281 34.949219 45.375 34.9375C45.605469 34.722656 45.722656 34.410156 45.6875 34.09375C45.6875 34.082031 45.6875 34.074219 45.6875 34.0625C46.171875 32.753906 46.640625 31.378906 47.0625 29.875C47.078125 29.8125 47.089844 29.75 47.09375 29.6875C47.09375 29.675781 47.09375 29.667969 47.09375 29.65625C48.425781 26.21875 46.941406 22.433594 43.75 20.78125L49.9375 3.625L49.9375 3.59375L49.96875 3.5625C50.171875 2.851563 49.9375 2.167969 49.5625 1.625C49.207031 1.113281 48.6875 0.710938 48.0625 0.4375L48.0625 0.40625C48.042969 0.398438 48.019531 0.414063 48 0.40625C47.988281 0.402344 47.980469 0.378906 47.96875 0.375C47.480469 0.144531 46.945313 -0.0117188 46.4375 -0.03125 Z M 46.3125 2.0625C46.539063 2.027344 46.835938 2.027344 47.15625 2.1875L47.1875 2.21875L47.21875 2.21875C47.542969 2.347656 47.8125 2.566406 47.9375 2.75C48.0625 2.933594 48.027344 3.042969 48.03125 3.03125L41.9375 19.9375C41.203125 19.605469 40.695313 19.371094 39.65625 18.90625C38.882813 18.558594 38.148438 18.222656 37.5 17.9375L45.9375 2.15625C45.929688 2.164063 46.085938 2.097656 46.3125 2.0625 Z M 4 8C1.800781 8 0 9.800781 0 12C0 14.199219 1.800781 16 4 16C6.199219 16 8 14.199219 8 12C8 9.800781 6.199219 8 4 8 Z M 4 10C5.117188 10 6 10.882813 6 12C6 13.117188 5.117188 14 4 14C2.882813 14 2 13.117188 2 12C2 10.882813 2.882813 10 4 10 Z M 13 11C11.894531 11 11 11.894531 11 13C11 14.105469 11.894531 15 13 15C14.105469 15 15 14.105469 15 13C15 11.894531 14.105469 11 13 11 Z M 11.5 18C8.472656 18 6 20.472656 6 23.5C6 26.527344 8.472656 29 11.5 29C14.527344 29 17 26.527344 17 23.5C17 20.472656 14.527344 18 11.5 18 Z M 32.8125 18.625C33.507813 18.644531 34.269531 18.785156 35.125 19.125C35.144531 19.136719 35.167969 19.148438 35.1875 19.15625C35.414063 19.511719 35.839844 19.6875 36.25 19.59375C36.363281 19.640625 36.351563 19.636719 36.46875 19.6875C37.144531 19.980469 37.996094 20.339844 38.84375 20.71875C40.085938 21.273438 40.871094 21.613281 41.59375 21.9375C41.613281 21.960938 41.632813 21.980469 41.65625 22C41.871094 22.296875 42.230469 22.453125 42.59375 22.40625C42.605469 22.40625 42.613281 22.40625 42.625 22.40625C45.015625 23.5 46.070313 26.105469 45.25 28.625C44.855469 28.613281 44.554688 28.632813 43.8125 28.46875C43.257813 28.347656 42.71875 28.152344 42.3125 27.90625C41.90625 27.660156 41.671875 27.417969 41.5625 27.09375C41.476563 26.8125 41.269531 26.585938 40.996094 26.472656C40.726563 26.355469 40.417969 26.367188 40.15625 26.5C39.820313 26.667969 38.972656 26.605469 38.21875 26.21875C37.84375 26.027344 37.507813 25.757813 37.28125 25.53125C37.054688 25.304688 36.992188 25.089844 37 25.125C36.945313 24.832031 36.765625 24.578125 36.503906 24.433594C36.246094 24.289063 35.933594 24.269531 35.65625 24.375C35.628906 24.386719 35.296875 24.417969 34.90625 24.34375C34.515625 24.269531 34.0625 24.109375 33.625 23.90625C33.1875 23.703125 32.785156 23.457031 32.53125 23.25C32.277344 23.042969 32.253906 22.828125 32.28125 23.09375C32.214844 22.566406 31.75 22.179688 31.21875 22.21875C30.214844 22.3125 29.273438 21.574219 28.71875 21.09375C29.304688 20.105469 30.03125 19.316406 30.9375 18.9375C31.492188 18.707031 32.117188 18.605469 32.8125 18.625 Z M 11.5 20C13.445313 20 15 21.554688 15 23.5C15 25.445313 13.445313 27 11.5 27C9.554688 27 8 25.445313 8 23.5C8 21.554688 9.554688 20 11.5 20 Z M 27.8125 22.96875C28.507813 23.46875 29.472656 23.988281 30.625 24.09375C30.808594 24.363281 31.007813 24.582031 31.25 24.78125C31.683594 25.140625 32.21875 25.457031 32.78125 25.71875C33.34375 25.980469 33.933594 26.199219 34.53125 26.3125C34.839844 26.371094 35.15625 26.253906 35.46875 26.25C35.617188 26.476563 35.683594 26.777344 35.875 26.96875C36.28125 27.375 36.765625 27.71875 37.3125 28C38.125 28.417969 39.101563 28.5625 40.0625 28.4375C40.390625 28.929688 40.785156 29.34375 41.25 29.625C41.933594 30.035156 42.679688 30.285156 43.375 30.4375C43.863281 30.542969 44.308594 30.589844 44.71875 30.625C44.441406 31.523438 44.140625 32.367188 43.84375 33.1875C43.484375 33.175781 43.042969 33.15625 42.5625 33.0625C41.46875 32.851563 40.433594 32.367188 40 31.53125C39.765625 31.09375 39.246094 30.894531 38.78125 31.0625C38.285156 31.238281 37.386719 31.164063 36.625 30.8125C35.863281 30.460938 35.285156 29.851563 35.15625 29.40625C35.074219 29.136719 34.878906 28.914063 34.621094 28.796875C34.367188 28.675781 34.074219 28.671875 33.8125 28.78125C33.570313 28.882813 32.625 28.855469 31.84375 28.5C31.0625 28.144531 30.558594 27.546875 30.5 27.21875C30.449219 26.941406 30.285156 26.703125 30.046875 26.554688C29.808594 26.40625 29.519531 26.363281 29.25 26.4375C28.304688 26.691406 27.566406 26.355469 26.96875 25.90625C26.761719 25.753906 26.609375 25.585938 26.46875 25.4375C26.953125 24.667969 27.402344 23.851563 27.8125 22.96875 Z M 25.3125 27.09375C25.460938 27.230469 25.601563 27.363281 25.78125 27.5C26.519531 28.054688 27.65625 28.449219 28.9375 28.375C29.402344 29.246094 30.15625 29.914063 31.03125 30.3125C31.894531 30.707031 32.816406 30.832031 33.71875 30.71875C34.21875 31.535156 34.914063 32.226563 35.78125 32.625C36.707031 33.050781 37.746094 33.160156 38.75 33C39.683594 34.167969 41.011719 34.804688 42.1875 35.03125C42.5 35.089844 42.808594 35.128906 43.09375 35.15625C41.429688 39.175781 39.566406 42.117188 37.9375 44.15625C35.851563 46.769531 34.441406 47.757813 34.125 47.96875C33.769531 47.953125 31.164063 47.769531 27.5 46.75C27.800781 46.554688 28.125 46.351563 28.46875 46.09375C30.136719 44.84375 32.320313 42.804688 34.4375 39.65625C34.660156 39.332031 34.675781 38.910156 34.472656 38.574219C34.269531 38.234375 33.890625 38.046875 33.5 38.09375C33.207031 38.125 32.945313 38.285156 32.78125 38.53125C30.796875 41.484375 28.753906 43.375 27.25 44.5C25.820313 45.570313 24.992188 45.902344 24.90625 45.9375C22.65625 45.144531 20.164063 44.058594 17.625 42.53125C17.992188 42.410156 18.382813 42.25 18.8125 42.0625C20.710938 41.234375 23.25 39.6875 25.84375 36.78125C26.15625 36.46875 26.226563 35.988281 26.019531 35.601563C25.808594 35.210938 25.371094 35.003906 24.9375 35.09375C24.707031 35.132813 24.496094 35.257813 24.34375 35.4375C21.9375 38.128906 19.683594 39.496094 18.03125 40.21875C16.378906 40.941406 15.4375 41 15.4375 41C15.394531 41.007813 15.351563 41.019531 15.3125 41.03125C13.238281 39.570313 11.167969 37.792969 9.21875 35.65625C11.121094 35.507813 13.570313 35.121094 16.59375 33.8125C19.578125 32.519531 22.761719 30.410156 25.3125 27.09375Z"/>
                        </svg>
                    </div>
                )}
            </div>
            <RentalProcessLog rental={rental} t={t} />
            <div className="mt-4 pt-2 border-t border-gray-100 flex justify-between items-center">
                {rental.refundStatus ? (
                     <div className="text-xs text-gray-600 space-x-2">
                        <span>{t('refund_status')}: <span className={`font-semibold ${refundStatusClass}`}>
                            {t(rental.refundStatus)}</span>
                        </span>
                        {rental.refundAmount != null && (
                            <span>{t('amount')}: <span className="font-semibold">
                                {rental.refundAmount === 'full' 
                                    ? t('full_refund') 
                                    : `${rental.symbol || ''}${Number(rental.refundAmount)?.toFixed(2)}`}
                            </span></span>
                        )}
                        {rental.refundDate && (
                            <span>{t('date')}: <span className="font-semibold">{formatDate(rental.refundDate)}</span></span>
                        )}
                     </div>
                ) : (
                    <div>
                        <span className="text-xs text-gray-500">{t('refund')}: {t('none')}</span>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    {canLock && (
                        <button
                            onClick={onLockClick}
                            className={`p-2 rounded-full ${lockButtonColor} transition-colors`}
                            title={rental.isLocked ? t('unlock_slot') : t('lock_slot')}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                            </svg>
                        </button>
                    )}
                    {onRefund && !hasRefundRequest(rental) && (
                        <button onClick={() => onRefund(rental)} className="text-xs bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md">
                            {t('refund')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function RentalsPage({ onNavigateToDashboard, onNavigateToChargers, clientInfo, rentalData, allStationsData, t, language, setLanguage, onLogout, onCommand, commandStatus, setCommandStatus, referenceTime, initialPeriod = 'today', initialStationIds = [], initialSearch = '' }) {
    const [activeFilters, setActiveFilters] = useState({ period: initialPeriod, status: 'all', returnType: 'all', version: 'all', gateway: 'all' });
    const [searchTerm, setSearchTerm] = useState(initialSearch);
    const [currentPage, setCurrentPage] = useState(1);
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [rentalToRefund, setRentalToRefund] = useState(null);
    const [commandDetails, setCommandDetails] = useState(null);
    const [commandModalOpen, setCommandModalOpen] = useState(false);

    const chargerLocations = useMemo(() => {
        const map = new Map();
        (allStationsData || []).forEach(kiosk => {
            (kiosk.modules || []).forEach(module => {
                (module.slots || []).forEach(slot => {
                    if (slot.sn && slot.sn !== 0) {
                        map.set(String(slot.sn), {
                            stationId: kiosk.stationid,
                            moduleId: module.id,
                            slotId: slot.position,
                            isLocked: !!slot.isLocked,
                            lockReason: slot.lockReason || '',
                        });
                    }
                });
            });
        });
        return map;
    }, [allStationsData]);

    const filteredRentals = useMemo(() => {
        const stationToClientMap = new Map();
        // We need to map both client and rep to correctly filter for partners.
        (allStationsData || []).forEach(station => {
            stationToClientMap.set(station.stationid, {
                clientId: station.info?.client,
                rep: station.info?.rep,
                location: station.info?.location,
                place: station.info?.place,
                version: isV2Kiosk(station) ? 'v2' : 'v1',
            });
        });

        let rentals = (rentalData || []).map(rental => {
            const chargerId = firstPresent(rental.sn, rental.chargerid);
            const chargerLocation = chargerLocations.get(String(chargerId || ''));
            const stationInfo = stationToClientMap.get(rental.rentalStationid);
            const stationVersion = stationInfo?.version || (isV2Kiosk({ stationid: rental.rentalStationid }) ? 'v2' : 'v1');
            return {
                ...rental, // Keep original rental data
                // Enrich with station info, but don't overwrite existing rental fields
                clientId: stationInfo?.clientId || rental.clientId,
                repId: stationInfo?.rep || rental.repId,
                location: chargerLocation,
                isLocked: chargerLocation?.isLocked || false,
                rentalLocation: rental.rentalLocation || stationInfo?.location,
                rentalPlace: rental.rentalPlace || stationInfo?.place,
                stationVersion,
            };
        });

        if (clientInfo && !clientInfo.isAdmin) {
            if (clientInfo.role === 'partner') {
                rentals = rentals.filter(r => textEquals(r.repId, clientInfo.clientId));
            } else {
                rentals = rentals.filter(r => textEquals(r.clientId, clientInfo.clientId));
            }
        }

        if (initialStationIds.length > 0) {
            const scopedStationIds = new Set(initialStationIds.map(stationId => String(stationId)));
            rentals = rentals.filter(rental => scopedStationIds.has(String(rental.rentalStationid)));
        }

        if (activeFilters.version && activeFilters.version !== 'all') {
            rentals = rentals.filter(r => r.stationVersion === activeFilters.version);
        }

        if (activeFilters.gateway && activeFilters.gateway !== 'all') {
            rentals = rentals.filter(r => normalizeText(r.gateway) === activeFilters.gateway);
        }

        const lowercasedSearch = normalizeText(searchTerm);
        const isCardLast4Search = /^\d{4}$/.test(lowercasedSearch);

        // Search is an override: once a query is entered, ignore period/status/return-type filters.
        if (lowercasedSearch) {
            if (isCardLast4Search) {
                rentals = rentals.filter(r => textEquals(r.card_last4, lowercasedSearch));

                return rentals.sort((a, b) => {
                    const bTime = getRentalActivityDate(b)?.getTime() ?? 0;
                    const aTime = getRentalActivityDate(a)?.getTime() ?? 0;
                    return bTime - aTime;
                });
            }

            rentals = rentals.filter(r =>
                textIncludes(r.rentalLocation, lowercasedSearch) ||
                textIncludes(r.rentalPlace, lowercasedSearch) ||
                textIncludes(r.rentalStationid, lowercasedSearch) ||
                textIncludes(r.card_last4, lowercasedSearch) ||
                textIncludes(r.sn, lowercasedSearch) ||
                textIncludes(r.chargerid, lowercasedSearch) ||
                textIncludes(r.vendState, lowercasedSearch) ||
                textIncludes(r.failureReason, lowercasedSearch) ||
                textIncludes(r.lastVendFailureReason, lowercasedSearch) ||
                (Array.isArray(r.vendAttempts) && r.vendAttempts.some(attempt => (
                    textIncludes(attempt.reason, lowercasedSearch) ||
                    textIncludes(attempt.exitStatus, lowercasedSearch) ||
                    textIncludes(attempt.solenoidStatus, lowercasedSearch)
                )))
            );

            return rentals.sort((a, b) => {
                const bTime = getRentalActivityDate(b)?.getTime() ?? 0;
                const aTime = getRentalActivityDate(a)?.getTime() ?? 0;
                return bTime - aTime;
            });
        }

        // Filter by period
        if (!referenceTime) return []; // Guard against undefined referenceTime

        const now = safeToDate(referenceTime) || new Date();
        let startDate;
        switch (activeFilters.period) {
            case 'today':
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                break;
            case '30days':
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 30);
                break;
            case '7days':
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 7);
                break;
            default: // Default to 'today'
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                break;
        }

        rentals = rentals.filter(r => {
            const rentalDate = getRentalActivityDate(r);
            return rentalDate && rentalDate >= startDate;
        });

        // Filter by status
        if (activeFilters.status === 'short_rental') {
            const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
            rentals = rentals.filter(r => isReturnedRentalStatus(r.status) && r.rentalPeriod && r.rentalPeriod < FIVE_MINUTES_IN_MS);
        } else if (activeFilters.status === 'refunded') {
            rentals = rentals.filter(isRefundedRental);
        } else if (activeFilters.status === 'error') {
            rentals = rentals.filter(hasRentalLogError);
        } else if (activeFilters.status !== 'all') {
            rentals = rentals.filter(r => normalizeRentalStatusKey(r.status) === activeFilters.status);
        }

        // Filter by returnType
        if (activeFilters.returnType && activeFilters.returnType !== 'all') {
            rentals = rentals.filter(r => r.returnType === activeFilters.returnType);
        }

        // Sort by most recent
        return rentals.sort((a, b) => {
            const bTime = getRentalActivityDate(b)?.getTime() ?? 0;
            const aTime = getRentalActivityDate(a)?.getTime() ?? 0;
            return bTime - aTime;
        });

    }, [rentalData, allStationsData, clientInfo, activeFilters, searchTerm, referenceTime, chargerLocations, initialStationIds]);

    const totalPages = Math.max(1, Math.ceil(filteredRentals.length / RENTALS_PER_PAGE));
    const visiblePage = Math.min(currentPage, totalPages);
    const pageStartIndex = filteredRentals.length === 0 ? 0 : ((visiblePage - 1) * RENTALS_PER_PAGE) + 1;
    const pageEndIndex = Math.min(visiblePage * RENTALS_PER_PAGE, filteredRentals.length);
    const paginatedRentals = useMemo(() => {
        const startIndex = (visiblePage - 1) * RENTALS_PER_PAGE;
        return filteredRentals.slice(startIndex, startIndex + RENTALS_PER_PAGE);
    }, [filteredRentals, visiblePage]);

    const handleFilterChange = (type, value) => {
        setActiveFilters(prev => ({ ...prev, [type]: value }));
        setCurrentPage(1);
    };

    const handleSearchChange = (event) => {
        setSearchTerm(event.target.value);
        setCurrentPage(1);
    };

    const handlePreviousPage = () => {
        setCurrentPage(page => Math.max(1, page - 1));
    };

    const handleNextPage = () => {
        setCurrentPage(page => Math.min(totalPages, page + 1));
    };

    const handleRefundClick = (rental) => {
        setRentalToRefund(rental);
        setShowRefundModal(true);
    };

    const handleConfirmRefund = (amount) => {
        if (rentalToRefund) {
            const station = allStationsData.find(s => s.stationid === rentalToRefund.rentalStationid);
            const gateway = resolveRefundGateway(rentalToRefund, station);
            const transactionid = resolveRefundTransactionId(rentalToRefund);
            // The onCommand function expects a different structure for refunds.
            // The 6th argument is used for the refund payload, which includes the transactionid.
            onCommand(rentalToRefund.rentalStationid, 'refund', null, null, null, { transactionid, orderId: transactionid, amount, gateway });
            setCommandStatus({ state: 'sending', message: t('sending_command') });
        }
        setShowRefundModal(false);
        setRentalToRefund(null);
    };

    const handleLockClick = (rental) => {
        if (!rental.location) return;
        const { stationId, moduleId, slotId, isLocked, lockReason } = rental.location;
        const action = isLocked ? 'unlock slot' : 'lock slot';
        const confirmationText = isLocked ? `${t('unlock_confirmation')} ${slotId}?` : `${t('lock_confirmation')} ${slotId}?`;
        
        setCommandDetails({
            stationid: stationId,
            moduleid: moduleId,
            slotid: slotId,
            action,
            confirmationText,
            lockReason: lockReason || '',
        });
        setCommandModalOpen(true);
    };

    const handleConfirmCommand = (reason = null) => {
        setCommandModalOpen(false);
        if (!commandDetails) return;

        const { stationid, action, moduleid, slotid } = commandDetails;
        onCommand(stationid, action, moduleid, null, null, { slotid, info: reason });
        setCommandStatus({ state: 'sending', message: t('sending_command') });
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
            <RefundModal
                isOpen={showRefundModal}
                onClose={() => setShowRefundModal(false)}
                onConfirm={handleConfirmRefund}
                rental={rentalToRefund}
                t={t}
            />
            <ConfirmationModal 
                isOpen={commandModalOpen} 
                onClose={() => setCommandModalOpen(false)}
                onConfirm={handleConfirmCommand}
                details={commandDetails}
                t={t}
            />
            <header className="bg-white shadow-sm">
                <div className="max-w-screen-xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    {/* Language buttons on the left */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setLanguage('en')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>EN</button>
                        <button onClick={() => setLanguage('fr')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'fr' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>FR</button>
                    </div>
                    {/* Action buttons on the right */}
                    <div className="flex items-center gap-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 mr-4" title={t('back_to_dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="max-w-screen-xl mx-auto py-6 sm:px-4 lg:px-6">
                {/* Filter Panel */}
                <div className="bg-white p-4 rounded-lg shadow-md mb-8">
                    <div className="flex flex-wrap items-center gap-4">
                        {['today', '7days', '30days'].map(period => (
                            <button key={period} onClick={() => handleFilterChange('period', period)}
                                className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${activeFilters.period === period ? 'bg-blue-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                                {t(period)}
                            </button>
                        ))}
                        <div className="flex-grow"></div>
                        <div className="text-right">
                            <span className="text-lg font-bold text-gray-800">{filteredRentals.length}</span>
                            <span className="text-sm text-gray-500 ml-2">{t('rentals')}</span>
                            {filteredRentals.length > RENTALS_PER_PAGE && (
                                <p className="text-xs text-gray-500">
                                    {t('showing')} {pageStartIndex}-{pageEndIndex}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-4">
                        {['all', 'rented', 'returned', 'purchased', 'refunded', 'pending', 'declined', 'vend_failed', 'short_rental', 'error', 'uid'].map(status => (
                            <button key={status} onClick={() => {
                                if (status === 'uid') {
                                    handleFilterChange('gateway', activeFilters.gateway === 'uid' ? 'all' : 'uid');
                                    return;
                                }

                                handleFilterChange('status', status);
                            }}
                                className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${
                                    (status === 'uid' ? activeFilters.gateway === 'uid' : activeFilters.status === status)
                                        ? (status === 'error' ? 'bg-red-600 text-white shadow' : 'bg-blue-600 text-white shadow')
                                        : (status === 'error' ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-100' : 'bg-gray-200 text-gray-700 hover:bg-gray-300')
                                }`}>
                                {status === 'error' ? t('log_errors_filter') : status === 'uid' ? 'UID' : t(status)}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-4 border-t pt-4">
                        {['all', 'auto-return', 'sweep-return'].map(returnType => (
                            <button key={returnType} onClick={() => handleFilterChange('returnType', returnType)}
                                className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${activeFilters.returnType === returnType ? 'bg-blue-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                                {t(returnType)}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 mt-4 border-t pt-4">
                        {['all', 'v1', 'v2'].map(version => (
                            <button key={version} onClick={() => handleFilterChange('version', version)}
                                className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${activeFilters.version === version ? 'bg-blue-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                                {version === 'all' ? t('all') : version.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <div className="relative mt-4">
                        <input
                            type="text"
                            placeholder={t('rentals_search_placeholder')}
                            value={searchTerm}
                            onChange={handleSearchChange}
                            className="w-full pl-9 pr-9 py-1.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                    </div>
                </div>

                {totalPages > 1 && (
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <button
                            onClick={handlePreviousPage}
                            disabled={visiblePage === 1}
                            className="px-4 py-2 text-sm font-semibold rounded-md bg-white text-gray-700 shadow-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('previous')}
                        </button>
                        <div className="text-sm font-medium text-gray-600">
                            {t('page')} {visiblePage} / {totalPages}
                        </div>
                        <button
                            onClick={handleNextPage}
                            disabled={visiblePage === totalPages}
                            className="px-4 py-2 text-sm font-semibold rounded-md bg-white text-gray-700 shadow-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('next')}
                        </button>
                    </div>
                )}

                {/* Rentals Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredRentals.length > 0 ? (
                        paginatedRentals.map(rental => {
                            const canLock = clientInfo?.commands?.lock && isReturnedRentalStatus(rental.status) && rental.location;
                            return <RentalCard 
                                key={`${rental.orderid}-${rental.status}-${getRentalActivityTimestamp(rental)}`}
                                rental={rental} t={t} 
                                onRefund={clientInfo?.features?.rentals ? handleRefundClick : null}
                                onLockClick={() => handleLockClick(rental)}
                                canLock={canLock}
                                onNavigateToChargers={onNavigateToChargers}
                                onNavigateToDashboard={onNavigateToDashboard} />;
                        })
                    ) : (
                        <div className="col-span-full text-center text-gray-500 mt-10 bg-white p-8 rounded-lg shadow-md">
                            {t('no_rentals_found')}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
