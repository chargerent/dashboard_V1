import { useId, useState } from 'react';

const labels = {
  ready: 'Company email ready',
  pending: 'Google account created — Gmail is activating',
  provisioning: 'Company email creation in progress',
  error: 'Company email needs attention',
};

export default function WorkspaceMailboxPanel({ mailbox, onRetry, busy = false, onRetryNotification, notificationBusy = false, onDismiss }) {
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  if (!mailbox) return null;
  const notificationNeedsAttention = ['error', 'unknown'].includes(mailbox.notificationStatus);
  const needsAttention = mailbox.status === 'error' || notificationNeedsAttention;
  return (
    <section aria-label="Company email status" className={`rounded-lg border p-4 ${needsAttention ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{labels[mailbox.status] || 'Company email'}</h3>
          <p className="break-all text-sm text-gray-700">{mailbox.email}</p>
        </div>
        {onDismiss && <button type="button" onClick={onDismiss} className="text-sm text-gray-600 hover:underline">Dismiss</button>}
      </div>
      {mailbox.message && <p className="mt-2 text-sm text-gray-700" role={needsAttention ? 'alert' : 'status'}>{mailbox.message}</p>}
      {mailbox.temporaryPassword && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-gray-800" htmlFor={passwordId}>Temporary Google password</label>
          <div className="flex flex-wrap items-center gap-2">
            <input id={passwordId} type={showPassword ? 'text' : 'password'} readOnly autoComplete="off"
              value={mailbox.temporaryPassword} className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2 font-mono text-sm" />
            <button type="button" onClick={() => setShowPassword(value => !value)} className="rounded border border-gray-300 bg-white px-3 py-2 text-sm">{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          <p className="text-xs text-gray-600">Save this password before dismissing and provide it to the partner separately. The automatic email contains their new address only. They must change this password when signing in to Google.</p>
        </div>
      )}
      {mailbox.passwordRecoveryRequired && !mailbox.temporaryPassword && (
        <p className="mt-2 text-sm text-gray-700">If you did not save the temporary password, reset it in Google Admin before handing over the account.</p>
      )}
      {mailbox.notificationStatus && (
        <div className="mt-3 border-t border-gray-300 pt-3">
          <h4 className="text-sm font-semibold text-gray-900">Partner notification</h4>
          <p className="mt-1 break-words text-sm text-gray-700" role={notificationNeedsAttention ? 'alert' : 'status'}>
            {mailbox.notificationMessage || (mailbox.notificationStatus === 'sent'
              ? `Company address email sent to ${mailbox.notificationEmail}.`
              : 'The company address email has not been confirmed.')}
          </p>
          {mailbox.notificationStatus === 'unknown' && <p className="mt-1 text-xs text-gray-600">Sending again could deliver a duplicate email.</p>}
          {onRetryNotification && ['error', 'unknown', 'pending'].includes(mailbox.notificationStatus) && ['pending', 'ready'].includes(mailbox.status) && (
            <button type="button" onClick={() => onRetryNotification({resendUnknown: mailbox.notificationStatus === 'unknown'})}
              disabled={busy || notificationBusy} className="mt-2 rounded border border-gray-400 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
              {notificationBusy ? 'Checking partner notification…' : mailbox.notificationStatus === 'unknown' ? 'Send notification again' : mailbox.notificationStatus === 'pending' ? 'Check notification' : 'Retry partner notification'}
            </button>
          )}
        </div>
      )}
      {onRetry && mailbox.status !== 'ready' && (
        <button type="button" onClick={onRetry} disabled={busy || notificationBusy} className="mt-3 rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
          {busy ? 'Checking company email…' : mailbox.status === 'error' ? 'Retry company email' : 'Check mailbox status'}
        </button>
      )}
    </section>
  );
}
