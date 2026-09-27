import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CreateClientForm from '../../src/pages/CreateClientForm.jsx';
import WorkspaceMailboxPanel from '../../src/components/WorkspaceMailboxPanel.jsx';
import { translations } from '../../src/utils/translations.js';
import '../../src/index.css';

function WorkspaceEmailPreview() {
  const [configured, setConfigured] = useState(true);
  const [failure, setFailure] = useState(false);
  const [notificationFailure, setNotificationFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [payload, setPayload] = useState(null);
  const [credentialsResult, setCredentialsResult] = useState(null);
  const t = key => translations.en?.[key] || key;
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h1 className="font-bold">Company email development preview</h1>
        <p className="text-sm">Local simulation. No accounts are created and no emails are sent.</p>
        <div className="mt-3 flex flex-wrap gap-5 text-sm">
          <label><input type="checkbox" checked={configured} onChange={e => setConfigured(e.target.checked)} /> Workspace connected</label>
          <label><input type="checkbox" checked={failure} onChange={e => setFailure(e.target.checked)} /> Simulate creation failure</label>
          <label><input type="checkbox" checked={notificationFailure} onChange={e => setNotificationFailure(e.target.checked)} /> Simulate address email failure</label>
        </div>
      </div>
      {result && <WorkspaceMailboxPanel mailbox={result} onDismiss={() => setResult(null)}
        onRetry={() => setResult(previous => ({...previous, status: 'ready', message: 'Preview: Google reports the mailbox is ready.'}))}
        onRetryNotification={() => setResult(previous => ({...previous, notificationStatus: 'sent', notificationMessage: 'Preview: the company address was emailed successfully.'}))} />}
      <CreateClientForm clients={[]} t={t} featuresList={['rentals', 'details', 'reporting']} commandsList={['edit', 'lock']}
        creating={busy} workspaceStatus={{configured, domain: 'charge.rent', message: 'Company email creation is not connected yet. You can still create a dashboard account.'}}
        onCheckWorkspaceEmail={async localPart => ({available: localPart !== 'g.gazelian', email: `${localPart}@charge.rent`})}
        onCancel={() => { setResult(null); setPayload(null); setCredentialsResult(null); }}
        onCreate={async request => {
          setBusy(true);
          await new Promise(resolve => setTimeout(resolve, 800));
          setBusy(false);
          if (failure) return {ok: false, message: 'Preview: creation failed. Correct the details and retry.'};
          const {password: _password, ...safeRequest} = request;
          setPayload(safeRequest);
          const credentialsPartnerKitIncluded = request.profile.role === 'partner' && request.includePartnerKit === true;
          const credentialsEmailSent = request.sendCredentials === true || credentialsPartnerKitIncluded;
          setCredentialsResult(credentialsEmailSent
            ? (credentialsPartnerKitIncluded ? 'Preview: dashboard login details and partner kit sent together.' : 'Preview: dashboard login credentials sent.')
            : null);
          if (request.workspaceMailbox) {
            setResult({status: 'pending', email: `${request.workspaceMailbox.localPart}@charge.rent`, temporaryPassword: 'Preview-only-password', message: 'Preview: account created; Gmail activation is pending.',
              notificationStatus: notificationFailure ? 'error' : 'sent',
              notificationEmail: request.profile.contact.email,
              notificationMessage: notificationFailure ? 'Preview: the company address email could not be sent.' : 'Preview: the company address was emailed successfully.',
            });
          }
          return {ok: true, credentialsEmailSent, credentialsPartnerKitIncluded};
        }} />
      {credentialsResult && <p role="status" className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{credentialsResult}</p>}
      {payload && <section aria-label="Preview request"><h2 className="font-bold">Preview request (password omitted)</h2><pre className="overflow-auto rounded bg-white p-4 text-xs">{JSON.stringify(payload, null, 2)}</pre></section>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<WorkspaceEmailPreview />);
