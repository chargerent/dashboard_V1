// src/pages/AdminPage.jsx
import { useState, useMemo, useEffect, useCallback } from 'react';
import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import ClientAdminCard from './ClientAdminCard.jsx';
import CreateClientForm from './CreateClientForm.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';

import { auth } from '../firebase-config';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase-config';
import { collection, getDocs } from 'firebase/firestore';

// permission keys
const featuresList = ['rentals', 'details', 'stationid', 'address', 'status', 'reporting', 'lease_revenue', 'rental_counts', 'rental_revenue', 'client_commission', 'rep_commission', 'search'];
const commandsList = ['edit', 'lock', 'eject', 'eject_multiple', 'updates', 'connectivity', 'reboot', 'reload', 'disable', 'client edit'];

function AdminPage({ onNavigateToDashboard, onLogout, t, onNavigateToProvisionPage, onNavigateToAgreement }) {
  const [clients, setClients] = useState([]);
  const [originalClients, setOriginalClients] = useState([]);
  const [loginAttempts, setLoginAttempts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState(null);

  const [showCreateClientForm, setShowCreateClientForm] = useState(false);

  const [editingClientUid, setEditingClientUid] = useState(null);
  const [editedClientData, setEditedClientData] = useState(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingCreateData, setPendingCreateData] = useState(null);

  // Cloud Function callables
  const listUsersFn = useMemo(() => httpsCallable(functions, 'admin_listUsers'), []);
  const upsertUserFn = useMemo(() => httpsCallable(functions, 'admin_upsertUserProfile'), []);
  const createUserFn = useMemo(() => httpsCallable(functions, 'admin_createAuthUserAndProfile'), []);
  const deleteUserFn = useMemo(() => httpsCallable(functions, 'admin_deleteUser'), []);
  const unlockUserFn = useMemo(() => httpsCallable(functions, 'admin_unlockUser'), []);
  const setPasswordFn = useMemo(() => httpsCallable(functions, 'admin_setUserPassword'), []);

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [res, attemptsSnap] = await Promise.all([
        listUsersFn({}),
        getDocs(collection(db, 'loginAttempts')),
      ]);

      const data = res?.data?.users || [];
      setClients(data);
      setOriginalClients(JSON.parse(JSON.stringify(data)));

      const attemptsMap = {};
      attemptsSnap.forEach(d => { attemptsMap[d.id] = d.data(); });
      setLoginAttempts(attemptsMap);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Failed to fetch clients (permission denied or backend not deployed).');
    } finally {
      setLoading(false);
    }
  }, [listUsersFn]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const hasChanges = useMemo(() => JSON.stringify(clients) !== JSON.stringify(originalClients), [clients, originalClients]);

  // ---- edit mode ----
  const handleEditClick = (uid) => {
    setEditingClientUid(uid);
    const clientToEdit = clients.find(c => c.uid === uid);
    if (!clientToEdit) return;

    const copy = JSON.parse(JSON.stringify(clientToEdit));
    if (!copy.contact) copy.contact = { name: '', email: '' };
    if (!copy.features) copy.features = {};
    if (!copy.features.defaultlanguage) copy.features.defaultlanguage = 'en';
    if (!copy.commands) copy.commands = {};
    setEditedClientData(copy);
  };

  const handleCancelEdit = () => {
    setEditingClientUid(null);
    setEditedClientData(null);
  };

  const handleClientDataChange = (key, value) => {
    setEditedClientData(prev => {
      const next = { ...prev };
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        next[parent] = { ...next[parent], [child]: value };
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleUpdateClient = async () => {
    if (!editedClientData) return;

    // Keep clientId uppercase
    const finalData = { ...editedClientData };
    if (finalData.clientId) finalData.clientId = String(finalData.clientId).trim().toUpperCase();

    // optimistic UI
    setClients(prev => prev.map(c => (c.uid === editingClientUid ? finalData : c)));
    setEditingClientUid(null);
    setEditedClientData(null);

    setSaveStatus({ state: 'sending', message: 'Updating client...' });

    const newPassword = String(finalData.password || '').trim();

    try {
      await upsertUserFn({
        uid: finalData.uid,
        profile: stripUnsafeFields(finalData),
      });

      if (newPassword) {
        await setPasswordFn({ uid: finalData.uid, password: newPassword });
      }

      setSaveStatus({ state: 'success', message: t('update_success') });
      await fetchClients(); // refresh from source of truth
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
      await fetchClients();
    }
  };

  // ---- create ----
  const handleCreateClient = ({ username, password, clientId, profile }) => {
    setSaveStatus(null);

    // avoid dup username in current list
    const uname = (username || '').toLowerCase();
    if (clients.some(c => (c.username || '').toLowerCase() === uname)) {
      setSaveStatus({ state: 'error', message: t('username_already_exists') });
      return;
    }

    setPendingCreateData({ username, password, clientId, profile });
    setCreateModalOpen(true);
  };

  const cancelCreate = () => {
    setCreateModalOpen(false);
    setPendingCreateData(null);
  };

  const confirmCreate = async () => {
    if (!pendingCreateData) return;
    setSaveStatus({ state: 'sending', message: 'Creating client...' });
    setCreateModalOpen(false);

    try {
      const { username, password, clientId, profile } = pendingCreateData;
      await createUserFn({ username, password, clientId, profile: stripUnsafeFields(profile) });
      setPendingCreateData(null);
      setShowCreateClientForm(false);
      setSaveStatus({ state: 'success', message: t('update_success') });
      await fetchClients();
    } catch (e) {
      console.error(e);
      setPendingCreateData(null);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
    }
  };

  // ---- delete ----
  const handleDeleteClick = (uid) => {
    setClientToDelete(uid);
    setDeleteModalOpen(true);
  };

  const cancelDelete = () => {
    setDeleteModalOpen(false);
    setClientToDelete(null);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;
    setSaveStatus({ state: 'sending', message: 'Deleting client...' });

    try {
      await deleteUserFn({ uid: clientToDelete });
      setSaveStatus({ state: 'success', message: t('update_success') });
      setDeleteModalOpen(false);
      setClientToDelete(null);
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || 'Failed to delete client' });
      setDeleteModalOpen(false);
    }
  };

  // Keep your “save permissions” button, but make it a no-op since we save immediately on changes.
  const handleSave = async () => {
    setSaveStatus({ state: 'success', message: 'Changes are saved instantly now.' });
  };

  // If your ClientAdminCard calls onPermissionChange, keep it:
  const handlePermissionChange = async (uid, type, key, value) => {
    const updated = clients.find(c => c.uid === uid);
    if (!updated) return;

    const next = JSON.parse(JSON.stringify(updated));
    if (key === undefined) {
      next[type] = value;
    } else {
      next[type] = { ...(next[type] || {}), [key]: value };
    }

    // optimistic
    setClients(prev => prev.map(c => (c.uid === uid ? next : c)));

    try {
      await upsertUserFn({ uid, profile: stripUnsafeFields(next) });
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || t('update_failed') });
      await fetchClients();
    }
  };

  const handleUnlockUser = async (username) => {
    setSaveStatus({ state: 'sending', message: 'Unlocking user...' });
    try {
      await unlockUserFn({ username });
      setSaveStatus({ state: 'success', message: 'User unlocked.' });
      await fetchClients();
    } catch (e) {
      console.error(e);
      setSaveStatus({ state: 'error', message: e?.message || 'Failed to unlock user' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={cancelDelete}
        onConfirm={confirmDelete}
        details={{
          title: t('delete_client_title'),
          confirmationText: `${t('delete_client_confirmation')} ${clientToDelete}?`,
        }}
        t={t}
      />

      <ConfirmationModal
        isOpen={createModalOpen}
        onClose={cancelCreate}
        onConfirm={confirmCreate}
        details={{
          title: 'Create New Client',
          confirmationText: `Create new client "${pendingCreateData?.username}" with Client ID "${pendingCreateData?.clientId}"?`,
        }}
        t={t}
      />

      <CommandStatusToast status={saveStatus} onDismiss={() => setSaveStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button onClick={() => {}} className={`px-2 py-1 text-sm font-bold rounded-md bg-blue-600 text-white`}>EN</button>
            <button onClick={() => {}} className={`px-2 py-1 text-sm font-bold rounded-md bg-gray-200 text-gray-700`}>FR</button>
          </div>

          <div className="flex items-center gap-4">
            <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>

            <button onClick={onNavigateToProvisionPage} className="p-2 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200" title={t('provision_kiosk')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>

            <button onClick={onNavigateToAgreement} className="p-2 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200" title={t('create_agreement')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </button>

            <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner t={t} />
          </div>
        ) : error ? (
          <p className="bg-red-100 text-red-700 p-3 rounded-md mb-4">{error}</p>
        ) : (
          <>
            {showCreateClientForm ? (
              <div className="mb-6">
                <CreateClientForm
                  clients={clients}
                  onCreate={handleCreateClient}
                  onCancel={() => setShowCreateClientForm(false)}
                  t={t}
                  featuresList={featuresList}
                  commandsList={commandsList}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {clients
                  .filter(client => client && client.username !== undefined)
                  .map(client => (
                    <ClientAdminCard
                      key={client.uid}
                      client={client}
                      onPermissionChange={(uid, type, key, value) => handlePermissionChange(uid, type, key, value)}
                      isEditing={editingClientUid === client.uid}
                      editedData={editedClientData}
                      onEdit={() => handleEditClick(client.uid)}
                      onCancel={handleCancelEdit}
                      onSave={handleUpdateClient}
                      onDataChange={handleClientDataChange}
                      onDelete={() => handleDeleteClick(client.uid)}
                      featuresList={featuresList}
                      currentUser={client}
                      commandsList={commandsList}
                      lockoutData={loginAttempts[client.username] || null}
                      onUnlock={() => handleUnlockUser(client.username)}
                      t={t}
                    />
                  ))}

                <div
                  className="bg-white rounded-lg shadow-md flex items-center justify-center p-6 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                  onClick={() => setShowCreateClientForm(true)}
                  style={{ minHeight: '180px' }}
                >
                  <div className="text-center text-gray-400">
                    <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M12 4v16m8-8H4" />
                    </svg>
                    <p className="mt-2 text-lg font-medium">{t('add_new_client')}</p>
                  </div>
                </div>
              </div>
            )}

            {!showCreateClientForm && (
              <div className="flex justify-end mt-8">
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {t('save_permissions')}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Strip anything we NEVER want in Firestore profiles from the browser
function stripUnsafeFields(client) {
  const c = JSON.parse(JSON.stringify(client || {}));
  delete c.password;
  delete c.Email;
  delete c.email;
  delete c.token;
  delete c.serverFlowVersion;
  delete c.serverUiVersion;
  return c;
}

export default AdminPage;